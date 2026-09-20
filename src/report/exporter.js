import { ProbeError, ERROR_CODES } from '../core/errors.js';

export function toJSON(report, options = {}) {
  return JSON.stringify(report, null, options.pretty === false ? 0 : 2);
}

export function toMarkdown(report) {
  const lines = [];
  lines.push('# COOP/COEP/CORP 与 SharedArrayBuffer 能力报告');
  lines.push('');
  lines.push(`- 生成时间: ${report.generatedAt}`);
  lines.push(`- 浏览器: ${report.matrix.browserLabel || report.context.userAgent || '未知'} (${report.matrix.browser || 'unknown'} ${report.matrix.version ?? '?'})`);
  lines.push(`- 安全上下文: ${report.context.secureContext ? '是' : '否'}`);
  lines.push(`- 跨源隔离: ${report.isolated ? '是' : '否'}`);
  lines.push(`- 总体结论: ${supportLabel(report.overall)}`);
  lines.push(`- 降级等级: ${report.fallback.level}`);
  lines.push('');
  lines.push('## 检测项');
  lines.push('');
  lines.push('| 检测项 | 结论 | 关键细节 | 耗时(ms) |');
  lines.push('| --- | --- | --- | --- |');
  report.findings.forEach((f) => {
    lines.push(`| ${f.id} | ${supportLabel(f.support)} | ${escapeCell(summarize(f))} | ${f.durationMs} |`);
  });
  lines.push('');
  lines.push('## 兼容矩阵（当前浏览器 vs 预期版本）');
  lines.push('');
  lines.push('| 特性 | 版本预期 | 实时检测 | 结论 |');
  lines.push('| --- | --- | --- | --- |');
  report.matrix.rows.forEach((row) => {
    lines.push(`| ${row.label} | ${row.expected === 'supported' ? '应支持' : row.expected === 'unsupported' ? '不支持(旧版本)' : '未知'} | ${row.actual ? supportLabel(row.actual) : '未测'} | ${row.expected !== 'unknown' && row.actual && row.expected !== row.actual ? '⚠ 差异' : '一致/未测'} |`);
  });
  lines.push('');
  lines.push('### 完整矩阵（最低支持版本）');
  lines.push('');
  const cols = report.matrix.columns;
  lines.push(`| 特性 | ${cols.map((c) => report.matrix.columnLabels[c]).join(' | ')} |`);
  lines.push(`| --- | ${cols.map(() => '---').join(' | ')} |`);
  report.matrix.rows.forEach((row) => {
    lines.push(`| ${row.label} | ${cols.map((c) => row.browsers[c].label + (row.browsers[c].approx ? ' ~' : '')).join(' | ')} |`);
  });
  lines.push('');
  lines.push('## 降级动作');
  lines.push('');
  if (!report.fallback.actions.length) {
    lines.push('- 无需降级，全部能力可用');
  } else {
    report.fallback.actions.forEach((a) => lines.push(`- **[${a.level}] ${a.area}**: ${a.title} — ${a.detail}`));
  }
  lines.push('');
  if (report.exceptions.length) {
    lines.push('## 异常');
    lines.push('');
    report.exceptions.forEach((e) => lines.push(`- \`${e.code}\`: ${e.message}`));
    lines.push('');
  }
  lines.push(`> 矩阵来源: ${report.matrix.note}`);
  return lines.join('\n');
}

export function toCSV(report) {
  const rows = [['finding', 'support', 'duration_ms', 'detail']];
  report.findings.forEach((f) => {
    rows.push([f.id, f.support, String(f.durationMs), csvCell(summarize(f))]);
  });
  report.matrix.rows.forEach((row) => {
    rows.push([`matrix:${row.feature}`, row.actual || 'untested', '', csvCell(`expected=${row.expected}`)]);
  });
  return rows.map((r) => r.join(',')).join('\n');
}

export function toHTML(report) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const findingRows = report.findings.map((f) => `
    <tr class="support-${esc(f.support)}">
      <td>${esc(f.id)}</td><td>${esc(supportLabel(f.support))}</td>
      <td><code>${esc(summarize(f))}</code></td><td>${f.durationMs}</td>
    </tr>`).join('');
  const matrixRows = report.matrix.rows.map((row) => `
    <tr>
      <td>${esc(row.label)}</td>
      <td>${esc(row.expected)}</td>
      <td>${esc(row.actual || 'untested')}</td>
    </tr>`).join('');
  const actions = report.fallback.actions.length
    ? report.fallback.actions.map((a) => `<li class="level-${esc(a.level)}">[${esc(a.level)}] ${esc(a.title)} — ${esc(a.detail)}</li>`).join('')
    : '<li>无需降级</li>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>COI 能力报告</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;font-size:.9rem}
.support-supported{background:#e6ffed}.support-unsupported{background:#ffecec}
.support-partial{background:#fff8e1}.support-error{background:#fde7f3}
.level-critical{color:#b00020}.level-warning{color:#a26100}
</style></head><body>
<h1>COOP/COEP/CORP 能力报告</h1>
<p>生成时间: ${esc(report.generatedAt)} · 隔离: ${report.isolated ? '是' : '否'} · 结论: ${esc(supportLabel(report.overall))} · 降级: ${esc(report.fallback.level)}</p>
<h2>检测项</h2><table><thead><tr><th>项</th><th>结论</th><th>细节</th><th>ms</th></tr></thead><tbody>${findingRows}</tbody></table>
<h2>兼容矩阵（当前浏览器）</h2><table><thead><tr><th>特性</th><th>版本预期</th><th>实时检测</th></tr></thead><tbody>${matrixRows}</tbody></table>
<h2>降级动作</h2><ul>${actions}</ul>
</body></html>`;
}

export async function downloadReport(report, format = 'json', host) {
  const win = host.global;
  const producers = { json: () => toJSON(report), markdown: () => toMarkdown(report), csv: () => toCSV(report), html: () => toHTML(report) };
  const producer = producers[format];
  if (!producer) throw new ProbeError(ERROR_CODES.EXPORT_FAILED, `不支持的导出格式: ${format}`);
  const mime = { json: 'application/json', markdown: 'text/markdown', csv: 'text/csv', html: 'text/html' }[format];
  const ext = { json: 'json', markdown: 'md', csv: 'csv', html: 'html' }[format];
  try {
    const content = producer();
    if (host.runtime === 'browser' && win.Blob && win.URL && win.document) {
      const blob = new win.Blob([content], { type: `${mime};charset=utf-8` });
      const url = win.URL.createObjectURL(blob);
      const a = win.document.createElement('a');
      a.href = url;
      a.download = `coi-report-${Date.now()}.${ext}`;
      win.document.body.appendChild(a);
      a.click();
      a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
      return { downloaded: true, filename: a.download };
    }
    return { downloaded: false, content, mime, suggestedFilename: `coi-report.${ext}` };
  } catch (error) {
    throw new ProbeError(ERROR_CODES.EXPORT_FAILED, `导出 ${format} 失败: ${error.message || error}`, error);
  }
}

export function logToConsole(report, logger = console) {
  const group = typeof logger.groupCollapsed === 'function' ? logger.groupCollapsed.bind(logger) : logger.log.bind(logger);
  const groupEnd = typeof logger.groupEnd === 'function' ? logger.groupEnd.bind(logger) : () => {};
  group(`%c[COI 能力报告] ${report.isolated ? '已隔离' : '未隔离'} / ${report.overall} / 降级: ${report.fallback.level}`,
    'font-weight:bold;color:#0b57d0');
  logger.table(report.findings.map((f) => ({ id: f.id, support: f.support, ms: f.durationMs, detail: summarize(f) })));
  if (report.fallback.actions.length) {
    logger.warn('降级动作:', report.fallback.actions);
  }
  if (report.exceptions.length) {
    logger.error('检测异常:', report.exceptions);
  }
  groupEnd();
}

function summarize(finding) {
  const d = finding.details || {};
  switch (finding.id) {
    case 'coop':
    case 'coep':
      return String(d.header || '未配置');
    case 'corp':
      return d.documentHeader ? `doc=${d.documentHeader}` : `probes=${(d.probes || []).length}`;
    case 'sab':
      return `isolated=${d.crossOriginIsolated},ctor=${d.constructorUsable},atomics=${d.atomicsAvailable}`;
    case 'featurePolicy':
      return `legacy=${d.legacyFeaturePolicy},modern=${d.permissionsPolicy}`;
    case 'workers':
      return `classic=${d.dedicated && d.dedicated.available},module=${d.module && d.module.available},shared=${d.shared && d.shared.available},sab=${!!(d.workerSab && d.workerSab.available)}`;
    case 'idb':
      return `crud=${d.crudVerified}`;
    default:
      return '';
  }
}

function supportLabel(support) {
  return {
    supported: '✅ 支持',
    unsupported: '❌ 不支持',
    partial: '🟡 部分支持',
    unknown: '⚪ 未知',
    error: '⚠ 异常'
  }[support] || support;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function csvCell(text) {
  const value = String(text);
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
