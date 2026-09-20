// UI 编排：检测运行、结果渲染、降级演示、矩阵、导出、历史、异常中心、跨标签同步。
import { Util } from './util.js';
import { Detector } from './detector.js';
import { Fallback, TIERS, BufferChannel, KVStore } from './fallback.js';
import { Report } from './report.js';
import { MATRIX_META, BROWSER_LABELS, BROWSERS, buildMatrixRows, detectBrowser } from './matrix.js';

Report.setKV(KVStore);

const $ = (sel) => document.querySelector(sel);
const state = {
  report: null,
  store: null,
  channel: null,
  filter: 'all',
  demoChannel: null,
};

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function setBadge() {
  const e = Util.env();
  const badge = $('#modeBadge');
  if (e.isFile) {
    badge.textContent = 'file:// 本地文件：探针类检测将跳过';
    badge.className = 'badge normal';
  } else if (e.isolatedPath) {
    badge.textContent = '隔离页面 /isolated：COOP same-origin + COEP require-corp';
    badge.className = 'badge isolated';
  } else {
    badge.textContent = '普通页面（未跨源隔离）· 可访问 /isolated 验证完整能力';
    badge.className = 'badge normal';
  }
}

function showAlert() {
  const e = Util.env();
  const el = $('#globalAlert');
  if (!e.isSecure && !e.isFile) {
    el.className = 'alert crit';
    el.textContent = '当前不是安全上下文（非 HTTPS 且非 localhost），浏览器通常会禁用 SharedArrayBuffer。';
  } else if (e.isFile) {
    el.className = 'alert warn';
    el.textContent = 'file:// 模式：Worker/IDB 等本地检测可运行，但 COOP/COEP/CORP 网络探针将全部跳过；建议用 node server/server.mjs。';
  } else if (!e.isolatedPath) {
    el.className = 'alert info';
    el.innerHTML = '当前为普通页面。要验证 COOP/COEP 生效与 SAB 共享，请打开 <a href="/isolated">/isolated 隔离页面</a>。';
  } else {
    el.className = 'alert hidden';
    el.textContent = '';
  }
}

// ---- 检测运行 ----
async function runDetection() {
  $('#btnRun').disabled = true;
  $('#btnSave').disabled = true;
  $('#btnExport').disabled = true;
  const total = Detector.checks().length;
  let done = 0;
  const prog = $('#progressLine');
  prog.innerHTML = `<span class="bar"><i style="width:0%"></i></span>检测中…`;

  const report = await Detector.run((result, all) => {
    done = all.length;
    const pct = Math.round((done / total) * 100);
    prog.innerHTML = `<span class="bar"><i style="width:${pct}%"></i></span>${done}/${total} · ${result.name} → ${Report.statusLabel(result.status)}`;
  });

  state.report = report;
  state.store = new KVStore(report);
  $('#storageNotice') && ($('#storageNotice').textContent = state.store.notice || '报告历史持久化于 IndexedDB。');
  renderAll(report);
  $('#btnRun').disabled = false;
  $('#btnSave').disabled = false;
  $('#btnExport').disabled = false;
  prog.textContent = `检测完成：${report.errorCount} 个异常/超时，${report.skipCount} 项跳过，选中第 ${report.tier} 档。`;
  Report.toConsole(report);
}

// ---- 渲染 ----
function renderAll(report) {
  $('#summaryCard').classList.remove('hidden');
  $('#checksCard').classList.remove('hidden');
  $('#fallbackCard').classList.remove('hidden');
  $('#demoCard').classList.remove('hidden');
  $('#matrixCard').classList.remove('hidden');
  $('#historyCard').classList.remove('hidden');
  renderSummary(report);
  renderChecks(report);
  renderFallback(report);
  renderMatrix(report);
  renderErrors(report);
  refreshHistory();
}

function renderSummary(report) {
  const s = {
    supported: report.results.filter((r) => r.status === 'supported').length,
    partial: report.results.filter((r) => r.status === 'partial').length,
    unsupported: report.results.filter((r) => r.status === 'unsupported').length,
    skipped: report.results.filter((r) => r.status === 'skipped').length,
    error: report.results.filter((r) => ['error', 'timeout'].includes(r.status)).length,
  };
  $('#statGrid').innerHTML = [
    ['ok', s.supported, '支持'],
    ['warn', s.partial, '部分支持'],
    ['info', s.unsupported, '不支持'],
    ['info', s.skipped, '跳过'],
    ['crit', s.error, '异常/超时'],
    ['info', report.results.filter((r) => r.status === 'info').length, '信息'],
  ]
    .map(([cls, n, label]) => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`)
    .join('');

  const info = TIERS.find((t) => t.level === report.tier);
  const verdict = $('#verdict');
  verdict.className = `verdict t${report.tier}`;
  verdict.innerHTML = `自动选型：<b>第 ${report.tier} 档 — ${info.title}</b><br><span style="font-weight:normal">${info.desc}</span>`;
}

function renderFilters(report) {
  const groups = ['all', ...new Set(report.results.map((r) => r.group))];
  $('#filters').innerHTML = groups
    .map((g) => `<button data-g="${g}" class="${state.filter === g ? 'active' : ''}">${g === 'all' ? '全部' : g}</button>`)
    .join('');
  $('#filters').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      state.filter = b.dataset.g;
      renderFilters(report);
      renderChecks(report);
    }),
  );
}

function renderChecks(report) {
  renderFilters(report);
  const rows = state.filter === 'all' ? report.results : report.results.filter((r) => r.group === state.filter);
  $('#checksList').innerHTML = rows
    .map(
      (r) => `
    <div class="check">
      <div class="check-head" data-id="${r.id}" data-status="${r.status}">
        <span class="tag ${r.status}">${Report.statusLabel(r.status)}</span>
        <span class="check-name"><span class="check-group">[${r.group}]</span>${r.name}</span>
        <span class="dur">${r.durationMs}ms</span>
      </div>
      <div class="check-body"><p>${r.detail || ''}</p></div>
    </div>`,
    )
    .join('');
  $('#checksList').querySelectorAll('.check-head').forEach((h) =>
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('hidden')),
  );
  // 默认折叠明细
  $('#checksList').querySelectorAll('.check-body').forEach((b) => {
    const status = b.previousElementSibling.dataset.status;
    if (!['error', 'timeout', 'partial', 'skipped'].includes(status)) b.classList.add('hidden');
  });
}

function renderFallback(report) {
  const selected = Fallback.selectTier(report);
  $('#tierLadder').innerHTML = TIERS.map(
    (t) => `
    <div class="tier ${t.level === selected ? 'active' : ''}">
      <h3>${t.title}</h3>
      <div class="lv">第 ${t.level} 档${t.level === selected ? ' · 已选中' : ''}</div>
      <p>${t.desc}</p>
      <p>前置：${t.needs.length ? t.needs.join(' + ') : '无（兜底）'}</p>
    </div>`,
  ).join('');

  const gaps = Fallback.gaps(report);
  $('#gapList').innerHTML = gaps.length
    ? gaps.map((g) => `<div class="gap-item"><b>${g.fix}</b>：${g.detail}</div>`).join('')
    : '<div class="gap-item" style="background:var(--ok-bg);border-color:#2da44e66"><b>无缺口</b>：最高档能力全部具备。</div>';
}

function renderMatrix(report) {
  const rows = buildMatrixRows(report);
  const ua = detectBrowser(report.env?.userAgent);
  $('#matrixMeta').textContent = `参考数据：${MATRIX_META.snapshot} 快照 · ${MATRIX_META.disclaimer}`;
  const thead = $('#matrixTable').querySelector('thead');
  const tbody = $('#matrixTable').querySelector('tbody');
  thead.innerHTML = `<tr><th>检测项</th>${BROWSERS.map((b) => `<th>${BROWSER_LABELS[b]}</th>`).join('')}<th>本机实测</th></tr>`;
  const liveDot = {
    supported: '<span class="tag supported">支持</span>',
    unsupported: '<span class="tag unsupported">否</span>',
    partial: '<span class="tag partial">部分</span>',
    skipped: '<span class="tag skipped">跳过</span>',
    error: '<span class="tag error">错误</span>',
    timeout: '<span class="tag timeout">超时</span>',
    info: '<span class="tag info">信息</span>',
    untested: '—',
  };
  tbody.innerHTML = rows
    .map(
      (row) => `
    <tr class="${row.currentBrowser !== 'unknown' && BROWSERS.includes(row.currentBrowser) ? 'current' : ''}">
      <td title="${row.note.replace(/"/g, '&quot;')}">${row.name}<div class="hint" style="margin:2px 0 0">${row.group}</div></td>
      ${BROWSERS.map((b) => {
        const v = row.min?.[b];
        return `<td class="${v != null ? 'yes' : 'no'}">${v != null ? `${v}+` : '—'}</td>`;
      }).join('')}
      <td class="live-dot">${liveDot[row.liveStatus] || '—'}</td>
    </tr>`,
    )
    .join('');
}

function renderErrors(report) {
  const problems = report.results.filter((r) => ['error', 'timeout', 'partial', 'skipped', 'unsupported'].includes(r.status));
  const hard = report.results.filter((r) => ['error', 'timeout'].includes(r.status));
  $('#errorCount').textContent = hard.length;
  $('#errorCount').className = `pill ${hard.length ? '' : 'zero'}`;
  $('#errorsCard').classList.remove('hidden');
  if (!problems.length) {
    $('#errorList').innerHTML = '<div class="err-item info">全部检测正常，无异常或降级提示。</div>';
    return;
  }
  $('#errorList').innerHTML = problems
    .map((r) => {
      const cls = ['error', 'timeout'].includes(r.status) ? '' : r.status === 'partial' ? 'warn' : 'info';
      return `<div class="err-item ${cls}"><b>[${r.group}] ${r.name}</b>（${Report.statusLabel(r.status)}，${r.durationMs}ms）<br>${r.detail || ''}</div>`;
    })
    .join('');
}

// ---- 降级演示 ----
async function runDemo() {
  if (!state.report) return;
  const out = $('#demoOut');
  const size = Number($('#demoSize').value);
  const tier = Fallback.selectTier(state.report);
  out.textContent = `使用第 ${tier} 档通道处理 ${(size / 1024 / 1024).toFixed(1)} MB 数据…`;
  state.demoChannel?.dispose();
  const channel = new BufferChannel(tier);
  state.demoChannel = channel;
  try {
    await channel.start();
    // 第一次含启动开销，连跑两次取第二次作为稳态耗时更公平。
    await channel.process(size);
    const r = await channel.process(size);
    out.textContent =
      `通道：${r.mode}\n校验和：${r.sum}（每个字节填 7）\n拷贝字节：${r.bytesCopied}\n稳态耗时：${r.durationMs} ms\n` +
      `降级链路有效：即使第 1 档不可用，数据处理仍可完成（2→3→4 档自动切换）。`;
  } catch (err) {
    // 任何通道失败都再向下降一档重试一次，证明“降级可用”。
    const fallbackTier = Math.min(tier + 1, 4);
    out.textContent = `第 ${tier} 档失败（${Util.normalizeError(err).message}），自动降级到第 ${fallbackTier} 档重试…`;
    channel.dispose();
    const retry = new BufferChannel(fallbackTier);
    state.demoChannel = retry;
    await retry.start();
    const r = await retry.process(Math.min(size, 1048576));
    out.textContent += `\n已在第 ${fallbackTier} 档完成：通道=${r.mode}，校验和=${r.sum}，耗时=${r.durationMs}ms。`;
  }
}

// ---- 导出 / 历史 ----
async function handleExport(fmt) {
  if (!state.report) return;
  try {
    if (fmt === 'json') {
      Util.download(Report.filename(state.report, 'json'), Report.toJSON(state.report), 'application/json');
    } else if (fmt === 'markdown') {
      Util.download(Report.filename(state.report, 'md'), Report.toMarkdown(state.report), 'text/markdown');
    } else if (fmt === 'csv') {
      Util.download(Report.filename(state.report, 'csv'), '﻿' + Report.toCSV(state.report), 'text/csv');
    } else if (fmt === 'console') {
      Report.toConsole(state.report);
      toast('完整报告已输出到浏览器控制台');
    } else if (fmt === 'print') {
      window.print();
    } else if (fmt === 'copy-json') {
      await Util.copyText(Report.toJSON(state.report));
      toast('JSON 已复制到剪贴板');
    }
  } catch (err) {
    toast('导出失败：' + Util.normalizeError(err).message);
  }
}

async function saveReport() {
  if (!state.report || !state.store) return;
  try {
    const saved = await Report.save(state.report, state.store);
    toast(`报告 ${saved.id} 已保存（${state.store.backend}）`);
    state.channel?.postMessage({ type: 'report-saved', id: saved.id });
    refreshHistory();
  } catch (err) {
    toast('保存失败：' + Util.normalizeError(err).message);
  }
}

async function refreshHistory() {
  if (!state.store) return;
  const tbody = $('#historyBody');
  let items = [];
  try {
    items = await Report.list(state.store);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">读取历史失败：${Util.normalizeError(err).message}</td></tr>`;
    return;
  }
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5">暂无保存的报告。点击“保存报告”入库。</td></tr>';
    return;
  }
  tbody.innerHTML = items
    .slice(0, 20)
    .map(
      (it) => `
    <tr>
      <td>${Util.formatTime(new Date(it.savedAt).getTime())}</td>
      <td>${it.browser.label} ${it.browser.version ?? ''}</td>
      <td>第 ${it.selectedTier} 档</td>
      <td>支持 ${it.summary.supported} · 异常 ${it.summary.errors} · 跳过 ${it.summary.skipped}</td>
      <td class="btn-row">
        <button class="btn" data-act="view-json" data-id="${it.id}">查看JSON</button>
        <button class="btn" data-act="download" data-id="${it.id}">下载</button>
        <button class="btn" data-act="delete" data-id="${it.id}">删除</button>
      </td>
    </tr>`,
    )
    .join('');
}

async function historyClick(ev) {
  const btn = ev.target.closest('button[data-act]');
  if (!btn || !state.store) return;
  const id = btn.dataset.id;
  const item = await state.store.get(Report.key(id));
  if (!item) return;
  if (btn.dataset.act === 'view-json') {
    const w = window.open('', '_blank');
    if (w) {
      w.document.body.innerHTML = `<pre style="font:12px monospace;white-space:pre-wrap">${JSON.stringify(item, null, 2).replace(
        /[<>&]/g,
        (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]),
      )}</pre>`;
    }
  } else if (btn.dataset.act === 'download') {
    Util.download(`${id}.json`, JSON.stringify(item, null, 2), 'application/json');
  } else if (btn.dataset.act === 'delete') {
    await Report.remove(state.store, id);
    state.channel?.postMessage({ type: 'report-deleted', id });
    refreshHistory();
  }
}

// ---- ReportingObserver：收集 COEP/COOP 违规报告并提示 ----
function setupReportingObserver() {
  if (typeof globalThis.ReportingObserver !== 'function') return;
  const onReports = (reports) => {
    for (const rep of reports) {
      toast(`收到浏览器违规报告：${rep.type}（${rep.body?.type || ''}），已记录到控制台`);
      console.warn('[ReportingObserver]', rep);
    }
  };
  try {
    new ReportingObserver(onReports, { buffered: true, types: ['coep', 'coop', 'corp', 'deprecation'] }).observe();
  } catch {
    try {
      new ReportingObserver(onReports, { buffered: true }).observe();
    } catch { /* 无法观察时忽略，服务端 Reporting-Endpoints 仍可收集 */ }
  }
}

function setupChannel() {
  if (typeof globalThis.BroadcastChannel !== 'function') {
    window.addEventListener('storage', refreshHistory);
    return;
  }
  state.channel = new BroadcastChannel('coi-reports');
  state.channel.addEventListener('message', (ev) => {
    if (['report-saved', 'report-deleted'].includes(ev.data?.type)) refreshHistory();
  });
}

// ---- 初始化 ----
function init() {
  setBadge();
  showAlert();
  setupReportingObserver();
  setupChannel();
  $('#btnRun').addEventListener('click', runDetection);
  $('#btnSave').addEventListener('click', saveReport);
  $('#btnDemo').addEventListener('click', runDemo);
  $('#btnExport').addEventListener('click', () => $('#exportMenu').classList.toggle('hidden'));
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.dropdown')) $('#exportMenu').classList.add('hidden');
  });
  $('#exportMenu').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-fmt]');
    if (b) {
      $('#exportMenu').classList.add('hidden');
      handleExport(b.dataset.fmt);
    }
  });
  $('#historyBody').addEventListener('click', historyClick);
}

init();
