import { SUPPORT } from '../core/model.js';
import { ProbeError, ERROR_CODES } from '../core/errors.js';

const VALID = new Set(['same-origin', 'same-site', 'cross-origin']);

export function createCorpDetector(options = {}) {
  return async function detectCorp(host) {
    const policy = host.documentPolicy();
    const warnings = [];
    const probes = [];
    let support = SUPPORT.UNKNOWN;
    if (policy.corp) {
      support = VALID.has(policy.corp) ? SUPPORT.SUPPORTED : SUPPORT.PARTIAL;
    } else {
      support = SUPPORT.UNKNOWN;
      warnings.push('当前文档响应头未声明 CORP；CORP 是资源级响应头，可通过 probes 选项验证具体资源');
    }
    if (options.probes && options.probes.length) {
      const outcomes = await Promise.all(options.probes.map((entry) => probeResource(host, entry)));
      probes.push(...outcomes);
      const known = outcomes.filter((o) => o.status !== 'error');
      if (known.length) {
        const allMarked = known.every((o) => o.corp);
        support = allMarked ? SUPPORT.SUPPORTED : SUPPORT.PARTIAL;
        if (!allMarked) warnings.push('部分探测资源缺少 Cross-Origin-Resource-Policy 响应头');
      }
    }
    return {
      support,
      details: {
        documentHeader: policy.corp,
        probes
      },
      warnings
    };
  };
}

async function probeResource(host, entry) {
  const win = host.global;
  const url = typeof entry === 'string' ? entry : entry.url;
  const expected = typeof entry === 'object' ? entry.expected : null;
  if (host.runtime !== 'browser' || typeof win.fetch !== 'function') {
    return { url, status: 'skipped', reason: 'NO_FETCH' };
  }
  const controller = typeof win.AbortController === 'function' ? new win.AbortController() : null;
  const timer = win.setTimeout(() => controller && controller.abort(), 4000);
  try {
    const response = await win.fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'include',
      signal: controller ? controller.signal : undefined
    });
    const corp = response.headers.get('cross-origin-resource-policy');
    const ok = expected ? corp === expected : !!corp;
    return { url, status: ok ? 'pass' : 'fail', corp, expected };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { url, status: 'error', error: { code: ERROR_CODES.PROBE_HTTP_ERROR, message: '资源探测超时' } };
    }
    throw new ProbeError(ERROR_CODES.PROBE_HTTP_ERROR, `资源 ${url} 探测失败: ${error.message || error}`, error);
  } finally {
    win.clearTimeout(timer);
  }
}
