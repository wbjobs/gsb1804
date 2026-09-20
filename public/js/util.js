// 通用工具：环境探测、超时控制、异常归一化、下载/复制、Blob Worker。
export const Util = {
  env() {
    const loc = globalThis.location || { protocol: 'file:', href: '', hostname: '' };
    const port = loc.port ? Number(loc.port) : null;
    // 跨源探针端口约定：应用端口 + 1（与 server.mjs 的 ORIGIN2_PORT 默认一致）。
    const crossPort = port && port > 0 ? port + 1 : null;
    const host = loc.hostname || 'localhost';
    return {
      href: loc.href,
      protocol: loc.protocol,
      isFile: loc.protocol === 'file:',
      isSecure: globalThis.isSecureContext === true,
      isolatedPath: loc.pathname === '/isolated',
      sameOrigin: loc.isFile ? '' : loc.origin,
      crossOrigin: crossPort ? `http://${host}:${crossPort}` : '',
      userAgent: (globalThis.navigator && navigator.userAgent) || '',
    };
  },

  uaHints() {
    const uaData = globalThis.navigator && navigator.userAgentData;
    if (!uaData || typeof uaData.getHighEntropyValues !== 'function') return null;
    return uaData
      .getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'fullVersionList'])
      .then((d) => ({
        platform: d.platform,
        platformVersion: d.platformVersion,
        architecture: d.architecture,
        bitness: d.bitness,
        brands: d.fullVersionList || d.brands,
        mobile: d.mobile,
      }))
      .catch(() => null);
  },

  now() {
    return (globalThis.performance && performance.now && performance.now()) || Date.now();
  },

  // 包一段可能抛异常的探测代码，永不抛出。
  safe(fn, fallback = undefined) {
    try {
      return fn();
    } catch (err) {
      return this.isPromiseLike(fallback) ? fallback : fallback;
    }
  },

  isPromiseLike(v) {
    return v && typeof v.then === 'function';
  },

  // 超时竞速：超时不会取消底层操作，只让判定尽快返回。
  withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label || '操作'}超时（${ms}ms）`);
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  },

  normalizeError(err) {
    if (!err) return { name: 'Error', message: '未知错误' };
    return {
      name: err.name || err.constructor?.name || 'Error',
      message: String(err.message || err.reason || err),
      code: err.code || undefined,
    };
  },

  makeId() {
    return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },

  pad(n) {
    return String(n).padStart(2, '0');
  },

  formatTime(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())} ${this.pad(
      d.getHours(),
    )}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
  },

  download(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  async copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  },

  // 由函数源码生成同站 Blob Worker；隔离页面下 Blob 继承 COEP，可正常创建。
  blobWorkerUrl(source) {
    return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  },
};

// 统一的检测结果构造器
export function makeResult(id, name, group, partial = {}) {
  return {
    id,
    name,
    group,
    status: 'unsupported',
    severity: 'warn',
    detail: '',
    durationMs: 0,
    ...partial,
  };
}

// 判定严重级别：用于异常中心汇总
export function severityOf(status) {
  return {
    supported: 'ok',
    partial: 'warn',
    unsupported: 'warn',
    skipped: 'info',
    error: 'critical',
    timeout: 'critical',
  }[status] || 'info';
}
