// 报告生成与导出：JSON / Markdown / CSV / 控制台；历史存 KVStore（IDB→localStorage→内存）。
import { Util } from './util.js';
import { MATRIX_META, BROWSER_LABELS, buildMatrixRows, detectBrowser } from './matrix.js';
import { TIERS } from './fallback.js';

const STATUS_LABEL = {
  supported: '支持',
  unsupported: '不支持',
  partial: '部分支持',
  skipped: '已跳过',
  error: '错误',
  timeout: '超时',
  info: '信息',
  untested: '未检测',
};

export const Report = {
  statusLabel(s) {
    return STATUS_LABEL[s] || s;
  },

  enrich(report) {
    const browser = detectBrowser(report.env?.userAgent);
    return {
      schemaVersion: 1,
      id: Util.makeId(),
      savedAt: new Date().toISOString(),
      browser: {
        key: browser.key,
        label: BROWSER_LABELS[browser.key] || browser.alt || '未知',
        version: browser.version,
        userAgent: report.env?.userAgent || '',
        uaHints: report.env?.uaHints || null,
      },
      location: {
        href: report.env?.href || '',
        isolatedPath: report.env?.isolatedPath || false,
        secure: report.env?.isSecure || false,
      },
      selectedTier: report.tier,
      tierTitle: (TIERS.find((t) => t.level === report.tier) || {}).title || '',
      summary: {
        total: report.results.length,
        supported: report.results.filter((r) => r.status === 'supported').length,
        partial: report.results.filter((r) => r.status === 'partial').length,
        unsupported: report.results.filter((r) => r.status === 'unsupported').length,
        skipped: report.results.filter((r) => r.status === 'skipped').length,
        errors: report.results.filter((r) => ['error', 'timeout'].includes(r.status)).length,
      },
      checks: report.results.map((r) => ({
        id: r.id,
        name: r.name,
        group: r.group,
        status: r.status,
        severity: r.severity,
        detail: r.detail,
        durationMs: r.durationMs,
        data: r.data || undefined,
      })),
      warnings: report.warnings || [],
      matrixSnapshot: MATRIX_META.snapshot,
    };
  },

  toJSON(report, pretty = true) {
    return JSON.stringify(this.enrich(report), null, pretty ? 2 : 0);
  },

  toMarkdown(report) {
    const e = this.enrich(report);
    const lines = [];
    lines.push(`# COOP/COEP/CORP & SharedArrayBuffer 检测报告`);
    lines.push('');
    lines.push(`- 报告 ID：${e.id}`);
    lines.push(`- 生成时间：${Util.formatTime(new Date(e.savedAt).getTime())}`);
    lines.push(`- 浏览器：${e.browser.label} ${e.browser.version ?? ''}`);
    lines.push(`- 页面：${e.location.href}${e.location.isolatedPath ? '（/isolated 隔离模式）' : ''}`);
    lines.push(`- 安全上下文：${e.location.secure ? '是' : '否'}`);
    lines.push(`- 选中降级档：**第 ${e.selectedTier} 档 — ${e.tierTitle}**`);
    lines.push('');
    lines.push(`## 汇总`);
    lines.push('');
    lines.push(
      `支持 ${e.summary.supported} · 部分 ${e.summary.partial} · 不支持 ${e.summary.unsupported} · 跳过 ${e.summary.skipped} · 异常 ${e.summary.errors}（共 ${e.summary.total} 项）`,
    );
    lines.push('');
    const groups = [...new Set(e.checks.map((c) => c.group))];
    for (const group of groups) {
      lines.push(`## ${group}`);
      lines.push('');
      lines.push('| 检测项 | 结果 | 耗时 | 说明 |');
      lines.push('| --- | --- | --- | --- |');
      for (const c of e.checks.filter((x) => x.group === group)) {
        lines.push(
          `| ${c.name} | ${STATUS_LABEL[c.status]} | ${c.durationMs}ms | ${(c.detail || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
        );
      }
      lines.push('');
    }
    if (e.warnings.length) {
      lines.push('## 警告');
      lines.push('');
      e.warnings.forEach((w) => lines.push(`- ${w}`));
      lines.push('');
    }
    lines.push(`> 兼容矩阵参考快照：${MATRIX_META.snapshot}，以实机检测为准。`);
    return lines.join('\n');
  },

  toCSV(report) {
    const e = this.enrich(report);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['id', 'name', 'group', 'status', 'severity', 'durationMs', 'detail'].map(esc).join(',')];
    for (const c of e.checks) {
      rows.push([c.id, c.name, c.group, c.status, c.severity, c.durationMs, c.detail].map(esc).join(','));
    }
    return rows.join('\n');
  },

  toConsole(report) {
    const e = this.enrich(report);
    const color = {
      supported: 'color:#1a7f37',
      unsupported: 'color:#9a6700',
      partial: 'color:#9a6700',
      skipped: 'color:#57606a',
      error: 'color:#cf222e',
      timeout: 'color:#cf222e',
      info: 'color:#0969da',
    };
    /* eslint-disable no-console */
    console.group(`%c[COI 检测] 第 ${e.selectedTier} 档 · ${e.tierTitle}`, 'font-weight:bold');
    e.checks.forEach((c) => {
      console.log(`%c${STATUS_LABEL[c.status]}%c ${c.name} — ${c.detail}`, color[c.status] || '', 'color:inherit');
    });
    console.groupEnd();
    /* eslint-enable no-console */
  },

  // ---- 历史 ----
  storage(report) {
    return new (this._KV())(report);
  },

  _KV() {
    return this._KVCtor;
  },

  setKV(KVCtor) {
    this._KVCtor = KVCtor;
  },

  key(id) {
    return `coi-report:${id}`;
  },

  async save(report, store) {
    const e = this.enrich(report);
    await store.set(this.key(e.id), e);
    return e;
  },

  async list(store) {
    const keys = await store.keys();
    const all = [];
    for (const k of keys) {
      const item = await store.get(k);
      if (item && item.schemaVersion) all.push(item);
    }
    return all.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  },

  async remove(store, id) {
    await store.delete(this.key(id));
  },

  filename(report, ext) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${Util.pad(d.getMonth() + 1)}${Util.pad(d.getDate())}-${Util.pad(d.getHours())}${Util.pad(d.getMinutes())}${Util.pad(d.getSeconds())}`;
    return `coi-report-${stamp}.${ext}`;
  },
};
