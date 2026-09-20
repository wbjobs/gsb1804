import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFallback } from '../src/fallback/rules.js';
import { createMutex, createTaskExecutor, resolveExecutionMode } from '../src/fallback/adapters.js';
import { createFinding, SUPPORT } from '../src/core/model.js';

function isolatedFindings(overrides = {}) {
  return [
    createFinding('coop', { support: SUPPORT.SUPPORTED, details: { header: 'same-origin' } }),
    createFinding('coep', { support: SUPPORT.SUPPORTED, details: { header: 'require-corp' } }),
    createFinding('corp', { support: SUPPORT.SUPPORTED, details: { documentHeader: 'same-origin', probes: [] } }),
    createFinding('sab', {
      support: SUPPORT.SUPPORTED,
      details: { crossOriginIsolated: true, constructorUsable: true, atomicsAvailable: true, waitAsyncAvailable: true, ...(overrides.sabDetails || {}) }
    }),
    createFinding('featurePolicy', { support: SUPPORT.SUPPORTED, details: { legacyFeaturePolicy: true, permissionsPolicy: true } }),
    createFinding('workers', {
      support: SUPPORT.SUPPORTED,
      details: {
        dedicated: { available: true },
        module: { available: true },
        shared: { available: true },
        workerSab: { available: overrides.workerSab === false ? false : true },
        workerIndexedDB: { available: true }
      }
    }),
    createFinding('idb', { support: SUPPORT.SUPPORTED, details: { crudVerified: true } })
  ];
}

test('完整能力：降级等级 full，无降级动作', () => {
  const plan = planFallback(isolatedFindings());
  assert.equal(plan.level, 'full');
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.strategies.computation.mode, 'shared-memory-worker');
  assert.equal(plan.strategies.isolation.isolated, true);
});

test('未隔离 + 无 worker + 无 IDB：critical 降级链完整', () => {
  const findings = [
    createFinding('coop', { support: SUPPORT.UNSUPPORTED, details: { header: null } }),
    createFinding('coep', { support: SUPPORT.UNSUPPORTED, details: { header: null } }),
    createFinding('corp', { support: SUPPORT.UNKNOWN, details: { documentHeader: null, probes: [] }, warnings: [] }),
    createFinding('sab', { support: SUPPORT.UNSUPPORTED, details: { crossOriginIsolated: false, constructorUsable: false, atomicsAvailable: false, waitAsyncAvailable: false } }),
    createFinding('featurePolicy', { support: SUPPORT.PARTIAL, details: { legacyFeaturePolicy: true, permissionsPolicy: false } }),
    createFinding('workers', {
      support: SUPPORT.UNSUPPORTED,
      details: { dedicated: { available: false }, module: { available: false }, shared: { available: false }, workerSab: { available: false }, workerIndexedDB: { available: false } }
    }),
    createFinding('idb', { support: SUPPORT.UNSUPPORTED, details: { crudVerified: false } })
  ];
  const plan = planFallback(findings);
  assert.equal(plan.level, 'degraded-critical');
  const areas = plan.actions.map((a) => a.area);
  for (const area of ['computation', 'isolation', 'worker', 'storage']) {
    assert.ok(areas.includes(area), `缺少 ${area} 降级动作`);
  }
  assert.equal(plan.strategies.computation.mode, 'main-thread');
  assert.deepEqual(plan.strategies.storage.fallback, ['json-download']);
});

test('SAB 可用但 worker 内 SAB 不可用：降为 shared-memory-main', () => {
  const findings = isolatedFindings({ workerSab: false });
  assert.equal(resolveExecutionMode(findings).mode, 'shared-memory-main');
});

test('仅 Worker 可用：postmessage-worker 降级', () => {
  const findings = isolatedFindings({ workerSab: false });
  findings[3].support = SUPPORT.UNSUPPORTED;
  findings[3].details.crossOriginIsolated = false;
  assert.equal(resolveExecutionMode(findings).mode, 'postmessage-worker');
});

test('createTaskExecutor 按模式选择实现，缺少实现抛带码异常', async () => {
  const host = { global: globalThis, crossOriginIsolated: () => false };
  const executor = createTaskExecutor(host, isolatedFindings(), {
    sharedWorker: async () => 'sab-result'
  });
  assert.equal(executor.mode, 'shared-memory-worker');
  assert.equal(await executor.run({}), 'sab-result');

  const mainOnlyFindings = isolatedFindings({ workerSab: false });
  mainOnlyFindings[3].support = SUPPORT.UNSUPPORTED;
  mainOnlyFindings[3].details.crossOriginIsolated = false;
  const fallback = createTaskExecutor(host, mainOnlyFindings, { main: async () => 'main-result' });
  assert.equal(fallback.mode, 'postmessage-worker');
});

test('Mutex: 无 Web Locks/SAB 时使用 Promise 链串行', async () => {
  const host = {
    global: {
      SharedArrayBuffer: undefined,
      navigator: {},
      setTimeout
    },
    crossOriginIsolated: () => false
  };
  const mutex = createMutex(host);
  assert.equal(mutex.mode, 'local-promise-chain');
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 5 }, () => mutex.runExclusive(() => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => setTimeout(() => { active -= 1; resolve(); }, 2));
  }, 'resource'));
  await Promise.all(tasks);
  assert.equal(maxActive, 1);
});

test('检测异常进入降级动作', () => {
  const findings = isolatedFindings();
  findings[6] = createFinding('idb', {
    support: SUPPORT.ERROR,
    error: { code: 'STORAGE_UNAVAILABLE', message: 'boom' },
    details: { crudVerified: false }
  });
  const plan = planFallback(findings);
  assert.ok(plan.actions.some((a) => a.area === 'idb' && /boom/.test(a.detail)));
});
