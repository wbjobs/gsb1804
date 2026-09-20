import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJSON, toMarkdown, toCSV, toHTML, downloadReport } from '../src/report/exporter.js';
import { createReport, SUPPORT } from '../src/core/model.js';

function sampleReport() {
  const report = createReport();
  report.generatedAt = '2026-09-20T12:00:00.000Z';
  report.isolated = false;
  report.overall = SUPPORT.PARTIAL;
  report.findings = [
    { id: 'coop', support: SUPPORT.UNSUPPORTED, details: { header: null }, warnings: [], error: null, durationMs: 1 },
    { id: 'sab', support: SUPPORT.UNSUPPORTED, details: { crossOriginIsolated: false, constructorUsable: true, atomicsAvailable: true }, warnings: ['未隔离'], error: null, durationMs: 2 }
  ];
  report.fallback = { level: 'degraded-critical', actions: [{ level: 'critical', area: 'isolation', title: 't', detail: 'd' }], strategies: {} };
  report.matrix = {
    browser: 'chrome', version: 120, browserLabel: 'Chrome (桌面/Android)',
    columns: ['chrome', 'firefox'],
    columnLabels: { chrome: 'Chrome', firefox: 'Firefox' },
    rows: [{
      feature: 'sab', label: 'SharedArrayBuffer (隔离后)', expected: 'supported', actual: 'unsupported',
      browsers: { chrome: { label: '88+', approx: false }, firefox: { label: '79+', approx: false } }
    }],
    note: 'note', lastReviewed: '2025', references: []
  };
  report.exceptions = [{ code: 'PROBE_BLOCKED', message: 'blocked' }];
  report.context = { userAgent: 'ua', platform: 'p', language: 'zh', url: 'u', secureContext: true, online: true, documentPolicy: {} };
  return report;
}

test('JSON 可往返解析', () => {
  const report = sampleReport();
  const parsed = JSON.parse(toJSON(report));
  assert.equal(parsed.schema, 'coi-capability-report/1.0');
  assert.equal(parsed.findings.length, 2);
});

test('Markdown 包含结论、矩阵表、降级与异常章节', () => {
  const md = toMarkdown(sampleReport());
  assert.match(md, /能力报告/);
  assert.match(md, /SharedArrayBuffer/);
  assert.match(md, /degraded-critical/);
  assert.match(md, /PROBE_BLOCKED/);
  assert.match(md, /\| Chrome \| Firefox \|/);
});

test('CSV 转义含逗号字段', () => {
  const csv = toCSV(sampleReport());
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'finding,support,duration_ms,detail');
  assert.ok(lines.some((l) => l.startsWith('coop,unsupported,1,')));
  assert.ok(lines.some((l) => l.includes('matrix:sab')));
});

test('HTML 转义并包含全部检测项', () => {
  const html = toHTML(sampleReport());
  assert.match(html, /<table>/);
  assert.match(html, /support-unsupported/);
  assert.doesNotMatch(html, /<script>/i);
});

test('未知导出格式抛 EXPORT_FAILED', async () => {
  const host = { runtime: 'node', global: globalThis };
  await assert.rejects(() => downloadReport(sampleReport(), 'pdf', host), (error) => error.code === 'EXPORT_FAILED');
});

test('Node 环境导出返回内容而非触发下载', async () => {
  const host = { runtime: 'node', global: globalThis };
  const result = await downloadReport(sampleReport(), 'json', host);
  assert.equal(result.downloaded, false);
  assert.match(result.content, /coi-capability-report/);
  assert.equal(result.suggestedFilename, 'coi-report.json');
});
