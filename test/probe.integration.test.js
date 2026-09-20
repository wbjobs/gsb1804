import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapabilityProbe } from '../src/probe.js';
import { createHost } from '../src/core/env.js';
import { createFakeWindow, createFakeIndexedDB } from './helpers.js';

test('端到端：隔离浏览器环境报告 SAB 可用、full、矩阵完整、无异常', async () => {
  const win = createFakeWindow({
    crossOriginIsolated: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin'
    },
    indexedDB: createFakeIndexedDB('ok')
  });
  const host = createHost(win);
  const report = await runCapabilityProbe({
    host,
    workers: { workerUrl: 'stub' },
    persist: false,
    console: false
  });
  assert.equal(report.isolated, true);
  assert.equal(report.findings.length, 7);
  const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
  assert.equal(byId.sab.support, 'supported');
  assert.equal(byId.coop.support, 'supported');
  assert.equal(byId.coep.support, 'supported');
  assert.equal(byId.workers.details.workerSab.available, true);
  assert.equal(byId.idb.support, 'supported');
  assert.equal(report.fallback.level, 'full');
  assert.ok(report.matrix.rows.length >= 14);
  assert.equal(report.exceptions.length, 0);
});

test('端到端：未隔离普通页报告 SAB 不可用并给出关键降级动作', async () => {
  const win = createFakeWindow({
    crossOriginIsolated: false,
    indexedDB: createFakeIndexedDB('ok')
  });
  const report = await runCapabilityProbe({
    host: createHost(win),
    workers: { workerUrl: 'stub' },
    persist: false,
    console: false
  });
  assert.equal(report.isolated, false);
  const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
  assert.equal(byId.sab.support, 'unsupported');
  assert.match(report.fallback.strategies.isolation.recipe.headers[0], /same-origin/);
  assert.ok(report.fallback.actions.some((a) => a.area === 'isolation'));
});

test('端到端：检测器抛异常被收集到 exceptions 且报告仍完整产出', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('blocked') });
  win.Worker = undefined;
  win.SharedWorker = undefined;
  win.document.featurePolicy = undefined;
  win.document.permissionsPolicy = undefined;
  const throwingDetector = async () => { throw new Error('unexpected boom'); };
  const report = await runCapabilityProbe({
    host: createHost(win),
    detectors: { coop: throwingDetector },
    persist: false,
    console: false
  });
  const coop = report.findings.find((f) => f.id === 'coop');
  assert.equal(coop.support, 'error');
  assert.equal(coop.error.code, 'UNEXPECTED');
  assert.ok(report.exceptions.some((e) => e.code === 'UNEXPECTED' && /boom/.test(e.message)));
  assert.ok(report.findings.every((f) => f.id));
});

test('端到端：存储失败被吞并记录，不影响报告返回（降级可用）', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('fail') });
  const report = await runCapabilityProbe({
    host: createHost(win),
    workers: { workerUrl: 'stub' },
    console: false
  });
  assert.equal(report.storage.backend, 'memory');
  assert.equal(report.findings.length, 7);
});

const here = dirname(fileURLToPath(import.meta.url));

test('构建产物 public/coi-probe-worker.js 与源字符串一致', () => {
  const artifact = readFileSync(join(here, '..', 'public', 'coi-probe-worker.js'), 'utf8');
  const source = readFileSync(join(here, '..', 'src', 'worker', 'probe-source.js'), 'utf8');
  const extracted = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
  assert.equal(artifact, extracted);
});
