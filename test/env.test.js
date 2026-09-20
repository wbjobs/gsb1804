import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, applyHeader, createHost } from '../src/core/env.js';

test('detectBrowser 识别主流浏览器与大版本', () => {
  assert.deepEqual(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0.2'), { name: 'edge', version: 120 });
  assert.deepEqual(detectBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0'), { name: 'firefox', version: 115 });
  assert.deepEqual(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15'), { name: 'safari', version: 17 });
  assert.deepEqual(detectBrowser('Mozilla/5.0 (Linux; Android 10) Chrome/120.0 Mobile Safari/537.36'), { name: 'chrome', version: 120 });
  assert.deepEqual(detectBrowser('Mozilla/5.0 (Linux; Android) SamsungBrowser/23.0 Chrome/115'), { name: 'samsung', version: 23 });
  assert.deepEqual(detectBrowser(''), { name: 'unknown', version: null });
});

test('applyHeader 解析 COOP/COEP/CORP 与 report-only', () => {
  const policy = { coop: null, coep: null, corp: null, coopReportOnly: null, coepReportOnly: null };
  applyHeader(policy, 'Cross-Origin-Opener-Policy', 'same-origin; report-to="x"');
  applyHeader(policy, 'cross-origin-embedder-policy', 'require-corp');
  applyHeader(policy, 'Cross-Origin-Resource-Policy', 'cross-origin');
  applyHeader(policy, 'Cross-Origin-Embedder-Policy-Report-Only', 'credentialless');
  assert.equal(policy.coop, 'same-origin');
  assert.equal(policy.coep, 'require-corp');
  assert.equal(policy.corp, 'cross-origin');
  assert.equal(policy.coepReportOnly, 'credentialless');
});

test('createHost 无浏览器时降级为 node host', () => {
  const host = createHost(undefined);
  assert.equal(host.runtime, 'node');
  assert.equal(host.crossOriginIsolated(), false);
  assert.deepEqual(host.documentPolicy(), { coop: null, coep: null, corp: null, coopReportOnly: null, coepReportOnly: null });
});
