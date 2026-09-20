import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportStore, memoryStore } from '../src/report/storage.js';
import { createHost } from '../src/core/env.js';
import { createFakeWindow, createFakeIndexedDB } from './helpers.js';

const report = { schema: 'coi-capability-report/1.0', overall: 'partial' };

test('IndexedDB 后端存取成功并标记 backend', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('ok') });
  const host = createHost(win);
  const store = createReportStore(host);
  assert.equal(store.backend, 'indexeddb');
  const saved = await store.save(report);
  assert.equal(saved.backend, 'indexeddb');
  const loaded = await store.load();
  assert.equal(loaded.report.overall, 'partial');
  await store.clear();
});

test('IndexedDB open 失败时 save 抛 STORAGE_UNAVAILABLE', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('fail') });
  const host = createHost(win);
  const store = createReportStore(host);
  await assert.rejects(() => store.save(report), (error) => error.code === 'STORAGE_UNAVAILABLE');
  const loaded = await store.load();
  assert.equal(loaded.report.overall, 'partial');
});

test('强制内存模式与 Node 环境使用内存后端', async () => {
  const win = createFakeWindow({ indexedDB: createFakeIndexedDB('ok') });
  const forcedMemory = createReportStore(createHost(win), { mode: 'memory' });
  assert.equal(forcedMemory.backend, 'memory');
  await forcedMemory.save(report);
  assert.equal((await forcedMemory.load()).report.overall, 'partial');
  await forcedMemory.clear();
  assert.equal(await forcedMemory.load(), null);

  const nodeStore = createReportStore(createHost(undefined));
  assert.equal(nodeStore.backend, 'memory');
});

test('memoryStore 直接可用（供 UI 手动降级）', async () => {
  const store = memoryStore('manual');
  assert.equal(store.backend, 'memory');
  assert.equal(store.reason, 'manual');
  await store.save({ v: 1 });
  assert.deepEqual((await store.load()).report, { v: 1 });
});
