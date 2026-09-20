import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMatrix } from '../src/matrix/engine.js';
import { MATRIX, FEATURES } from '../src/matrix/data.js';
import { SUPPORT } from '../src/core/model.js';

test('矩阵覆盖全部 FEATURES 且每个浏览器都有单元格', () => {
  const matrix = buildCompatibilityMatrix({ name: 'chrome', version: 120 }, []);
  assert.equal(matrix.rows.length, FEATURES.length);
  const keys = matrix.rows.map((r) => r.feature).sort();
  assert.deepEqual(keys, FEATURES.map((f) => f.key).sort());
  for (const row of matrix.rows) {
    for (const browser of matrix.columns) {
      assert.ok(row.browsers[browser], `${row.feature} 缺少 ${browser} 单元格`);
      assert.ok(typeof row.browsers[browser].label === 'string');
    }
  }
});

test('Chrome 120 预期支持 SAB，Chrome 70 预期不支持', () => {
  const latest = buildCompatibilityMatrix({ name: 'chrome', version: 120 }, []);
  const sab = latest.rows.find((r) => r.feature === 'sab');
  assert.equal(sab.expected, 'supported');
  const old = buildCompatibilityMatrix({ name: 'chrome', version: 70 }, []);
  assert.equal(old.rows.find((r) => r.feature === 'sab').expected, 'unsupported');
});

test('credentialless 在 Firefox 标记为不支持（null min）', () => {
  const matrix = buildCompatibilityMatrix({ name: 'firefox', version: 999 }, []);
  const row = matrix.rows.find((r) => r.feature === 'coep_credentialless');
  assert.equal(row.browsers.firefox.supported, false);
  assert.match(row.browsers.firefox.label, /不支持/);
});

test('实测与版本预期冲突进入 mismatches', () => {
  const findings = [{
    id: 'sab',
    support: SUPPORT.UNSUPPORTED,
    details: { crossOriginIsolated: false, constructorUsable: false, atomicsAvailable: true, waitAsyncAvailable: false }
  }];
  const matrix = buildCompatibilityMatrix({ name: 'chrome', version: 120 }, findings);
  assert.ok(matrix.mismatches.some((m) => m.feature === 'sab'));
});

test('矩阵引用来源存在', () => {
  assert.ok(MATRIX.references.length >= 3);
  MATRIX.references.forEach((ref) => assert.match(ref.url, /^https:\/\//));
});
