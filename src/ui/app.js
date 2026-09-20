import { runCapabilityProbe } from '../probe.js';
import { downloadReport } from '../report/exporter.js';
import { createHost } from '../core/env.js';

const els = {
  run: document.getElementById('run-btn'),
  overall: document.getElementById('overall'),
  pill: document.getElementById('isolation-pill'),
  exportRow: document.getElementById('export-row'),
  context: document.getElementById('context'),
  findings: document.getElementById('findings-body'),
  fallbackLevel: document.getElementById('fallback-level'),
  actions: document.getElementById('actions'),
  note: document.getElementById('matrix-note'),
  matrix: document.getElementById('matrix-table'),
  exceptions: document.getElementById('exceptions'),
  toast: document.getElementById('toast'),
  post: document.getElementById('post-btn')
};

let currentReport = null;

els.run.addEventListener('click', () => { void run(); });
document.querySelectorAll('[data-format]').forEach((button) => {
  button.addEventListener('click', () => { void exportReport(button.dataset.format); });
});
els.post.addEventListener('click', () => { void postReport(); });

async function run() {
  els.run.disabled = true;
  els.run.textContent = '检测中…';
  try {
    const host = createHost(window);
    const workerUrl = new URL('/coi-probe-worker.js', window.location.href).href;
    currentReport = await runCapabilityProbe({
      window,
      host,
      workers: { workerUrl },
      console: true
    });
    render(currentReport);
    if (currentReport.exceptions.length) {
      toast(`检测过程出现 ${currentReport.exceptions.length} 个异常，已记录在报告中`, 'warn');
    } else {
      toast('检测完成', 'ok');
    }
  } catch (error) {
    toast(`检测失败：${error.message || error}`, 'error');
  } finally {
    els.run.disabled = false;
    els.run.textContent = '重新检测';
  }
}

async function exportReport(format) {
  if (!currentReport) return;
  try {
    const result = await downloadReport(currentReport, format, createHost(window));
    if (!result.downloaded) {
      toast(`当前环境无法触发下载（${result.suggestedFilename}），内容已输出到控制台`, 'warn');
      console.log(result.content);
    } else {
      toast(`已导出 ${result.filename}`, 'ok');
    }
  } catch (error) {
    toast(`导出失败：${error.message}`, 'error');
  }
}

async function postReport() {
  if (!currentReport) return;
  try {
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(currentReport)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    toast('报告已上报', 'ok');
  } catch (error) {
    toast(`上报失败：${error.message}（报告仍可导出到本地）`, 'error');
  }
}

function render(report) {
  els.exportRow.hidden = false;
  setBadge(els.overall, report.overall, label(report.overall));
  els.pill.textContent = `隔离状态：${report.isolated ? '已隔离 crossOriginIsolated=true' : '未隔离'}`;
  els.pill.className = `status-pill ${report.isolated ? 'isolated' : 'relaxed'}`;

  els.context.innerHTML = '';
  kv(els.context, 'User-Agent', report.context.userAgent || '(Node/未知)');
  kv(els.context, '平台 / 语言', `${report.context.platform} · ${report.context.language}`);
  kv(els.context, '安全上下文', String(report.context.secureContext));
  kv(els.context, '在线状态', String(report.context.online));
  const policy = report.context.documentPolicy;
  kv(els.context, '响应策略', `COOP=${policy.coop || '-'} / COEP=${policy.coep || '-'} / CORP=${policy.corp || '-'}`);

  els.findings.innerHTML = '';
  report.findings.forEach((f) => {
    const tr = document.createElement('tr');
    const id = document.createElement('td');
    id.textContent = f.id;
    const support = document.createElement('td');
    const badge = document.createElement('span');
    setBadge(badge, f.support, label(f.support));
    support.appendChild(badge);
    const detail = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = JSON.stringify(f.details, null, 0);
    detail.appendChild(code);
    (f.warnings || []).forEach((w) => {
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = `⚠ ${w}`;
      detail.appendChild(p);
    });
    if (f.error) {
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = `异常 [${f.error.code}] ${f.error.message}`;
      detail.appendChild(p);
    }
    const ms = document.createElement('td');
    ms.textContent = `${f.durationMs} ms`;
    tr.append(id, support, detail, ms);
    els.findings.appendChild(tr);
  });

  els.fallbackLevel.textContent = `降级等级：${report.fallback.level}`;
  els.actions.innerHTML = '';
  if (!report.fallback.actions.length) {
    els.actions.textContent = '无需降级：完整能力可用';
  } else {
    report.fallback.actions.forEach((a) => {
      const div = document.createElement('div');
      div.className = `action ${a.level}`;
      div.innerHTML = `<b>${a.level}</b><strong>[${a.area}]</strong> ${escapeHtml(a.title)}<div class="muted">${escapeHtml(a.detail)}</div>`;
      els.actions.appendChild(div);
    });
  }

  renderMatrix(report.matrix);
  els.exceptions.innerHTML = report.exceptions.length
    ? report.exceptions.map((e) => `<div class="action warning"><b>异常</b><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.message)}</div>`).join('')
    : '无';
}

function renderMatrix(matrix) {
  els.note.textContent = `${matrix.note}（最近核对：${matrix.lastReviewed}；~ 表示灰度/平台近似）`;
  const cols = matrix.columns;
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = `<th>特性</th><th>当前浏览器实测</th><th>版本预期</th>${cols.map((c) => `<th>${escapeHtml(matrix.columnLabels[c])}</th>`).join('')}`;
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  matrix.rows.forEach((row) => {
    const tr = document.createElement('tr');
    const mismatch = row.actual && row.expected !== 'unknown' &&
      ((row.expected === 'supported' && row.actual === 'unsupported') ||
       (row.expected === 'unsupported' && row.actual === 'supported'));
    tr.innerHTML = `<td>${escapeHtml(row.label)}</td>
      <td><span class="badge ${row.actual || 'unknown'}">${row.actual ? label(row.actual) : '未测'}</span>${mismatch ? ' ⚠ 与版本预期不符' : ''}</td>
      <td class="muted">${row.expected === 'supported' ? '应支持' : row.expected === 'unsupported' ? '旧版本不支持' : '未知'}</td>
      ${cols.map((c) => {
        const cell = row.browsers[c];
        return `<td>${escapeHtml(cell.label)}${cell.approx ? ' <span class="approx">~</span>' : ''}${cell.note ? `<div class="approx">${escapeHtml(cell.note)}</div>` : ''}</td>`;
      }).join('')}`;
    tbody.appendChild(tr);
  });
  els.matrix.innerHTML = '';
  els.matrix.append(thead, tbody);
}

function kv(list, key, value) {
  const dt = document.createElement('dt');
  dt.textContent = key;
  const dd = document.createElement('dd');
  dd.textContent = value;
  list.append(dt, dd);
}

function setBadge(el, support, text) {
  el.className = `badge ${support}`;
  el.textContent = text;
}

function label(support) {
  return {
    supported: '支持',
    unsupported: '不支持',
    partial: '部分支持',
    unknown: '未知',
    error: '异常'
  }[support] || support;
}

function toast(message, kind = 'ok') {
  const item = document.createElement('div');
  item.className = `toast-item ${kind === 'ok' ? '' : kind}`;
  item.textContent = message;
  els.toast.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
