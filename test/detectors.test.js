import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../src/core/env.js';
import { createFakeWindow } from './helpers.js';
import { createCoopDetector } from '../src/detect/coop.js';
import { createCoepDetector } from '../src/detect/coep.js';
import { createSabDetector, runMainThreadChecks } from '../src/detect/sab.js';
import { createFeaturePolicyDetector } from '../src/detect/feature-policy.js';
import { createIdbDetector } from '../src/detect/idb.js';
import { createWorkersDetector } from '../src/detect/workers.js';
import { createFakeIndexedDB, FakeWorker } from './helpers.js';

async function detect(Detector, win, ...args) {
  return Detector(...args)(createHost(win));
}

test('COOP: same-origin 判定支持，allow-popups 判定部分，缺失判定不支持', async () => {
  const ok = await detect(createCoopDetector, createFakeWindow({ headers: { 'Cross-Origin-Opener-Policy': 'same-origin' } }));
  assert.equal(ok.support, 'supported');
  assert.equal(ok.details.isolating, true);

  const partial = await detect(createCoopDetector, createFakeWindow({ headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } }));
  assert.equal(partial.support, 'partial');

  const reportOnly = await detect(createCoopDetector, createFakeWindow({ headers: { 'Cross-Origin-Opener-Policy-Report-Only': 'same-origin' } }));
  assert.equal(reportOnly.support, 'unsupported');
  assert.match(reportOnly.warnings[0], /Report-Only/);

  const none = await detect(createCoopDetector, createFakeWindow());
  assert.equal(none.support, 'unsupported');
});

test('COEP: require-corp/credentialless/缺失 三种状态', async () => {
  assert.equal((await detect(createCoepDetector, createFakeWindow({ headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } }))).support, 'supported');
  const credless = await detect(createCoepDetector, createFakeWindow({ headers: { 'Cross-Origin-Embedder-Policy': 'credentialless' } }));
  assert.equal(credless.support, 'supported');
  assert.match(credless.warnings[0], /Firefox/);
  assert.equal((await detect(createCoepDetector, createFakeWindow())).support, 'unsupported');
});

test('SAB: 构造存在但未隔离时判定不支持，并给出降级提示', async () => {
  const win = createFakeWindow({ sab: true, crossOriginIsolated: false });
  const result = await detect(createSabDetector, win);
  assert.equal(result.support, 'unsupported');
  assert.equal(result.details.crossOriginIsolated, false);
  assert.equal(result.details.constructorUsable, true);
  assert.match(result.warnings[0], /未跨源隔离/);
});

test('SAB: 构造抛异常时记录错误原因', async () => {
  const win = createFakeWindow();
  win.SharedArrayBuffer = class {
    constructor() { throw new TypeError('blocked by cross-origin isolation'); }
  };
  const checks = runMainThreadChecks(createHost(win));
  assert.equal(checks.constructorExists, true);
  assert.equal(checks.constructorAvailable, false);
  assert.match(checks.failure, /blocked/);
});

test('Feature Policy: 双 API 判定支持，仅旧版判定部分', async () => {
  const both = await detect(createFeaturePolicyDetector, createFakeWindow());
  assert.equal(both.support, 'supported');
  assert.equal(both.details.legacyFeaturePolicy, true);
  assert.equal(both.details.permissionsPolicy, true);
  assert.equal(both.details.features['cross-origin-isolation'], true);

  const legacyOnly = await detect(createFeaturePolicyDetector, createFakeWindow({ permissionsPolicy: false }));
  assert.equal(legacyOnly.support, 'partial');
  assert.match(legacyOnly.warnings[0], /Permissions Policy/);
});

test('Workers: fake worker 探针返回 classic/module/shared 与 worker SAB/IDB', async () => {
  const win = createFakeWindow();
  const result = await createWorkersDetector({ workerUrl: 'stub' })(createHost(win));
  assert.equal(result.support, 'supported');
  assert.equal(result.details.dedicated.available, true);
  assert.equal(result.details.module.available, true);
  assert.equal(result.details.shared.available, true);
  assert.equal(result.details.workerSab.available, true);
  assert.equal(result.details.workerIndexedDB.available, true);
});

test('Workers: Worker 构造函数缺失时不支持并提示主线程降级', async () => {
  const win = createFakeWindow({ worker: false, sharedWorker: false });
  const result = await createWorkersDetector()(createHost(win));
  assert.equal(result.support, 'unsupported');
  assert.match(result.warnings[0], /Web Worker/);
});

test('Workers: Worker 创建抛异常被捕获为 error 而非整体崩溃', async () => {
  const win = createFakeWindow();
  win.Worker = class extends FakeWorker {
    constructor() { super(); throw new Error('CSP worker-src blocked'); }
  };
  const result = await createWorkersDetector()(createHost(win));
  assert.equal(result.details.dedicated.available, false);
  assert.match(result.details.dedicated.message, /CSP/);
});

test('IndexedDB: CRUD 自检成功判定支持', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('ok') });
  const result = await createIdbDetector({ timeoutMs: 1000 })(createHost(win));
  assert.equal(result.support, 'supported');
  assert.equal(result.details.crudVerified, true);
});

test('IndexedDB: open 失败时报错并给出降级警告', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('fail') });
  const result = await createIdbDetector({ timeoutMs: 1000 })(createHost(win));
  assert.equal(result.support, 'error');
  assert.match(result.warnings[0], /自检失败/);
});

test('IndexedDB: 事务中止（配额）映射为存储错误', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('tx-fail') });
  const result = await createIdbDetector({ timeoutMs: 1000 })(createHost(win));
  assert.equal(result.support, 'error');
  assert.match(result.error.message, /fake tx failure/);
});

test('IndexedDB: 完全不可用时判定 unsupported', async () => {
  const win = createFakeWindow();
  delete win.indexedDB;
  const result = await createIdbDetector()(createHost(win));
  assert.equal(result.support, 'unsupported');
  assert.match(result.warnings[0], /IndexedDB 不可用/);
});
