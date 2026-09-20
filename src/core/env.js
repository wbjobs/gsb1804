export function detectBrowser(uaString) {
  const ua = uaString || '';
  if (!ua) return { name: 'unknown', version: null };
  const edge = ua.match(/Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/);
  if (edge) return { name: 'edge', version: major(edge[1]) };
  const opr = ua.match(/OPR\/(\d+(?:\.\d+)*)/);
  if (opr) return { name: 'opera', version: major(opr[1]) };
  const samsung = ua.match(/SamsungBrowser\/(\d+(?:\.\d+)*)/);
  if (samsung) return { name: 'samsung', version: major(samsung[1]) };
  const firefox = ua.match(/(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/);
  if (firefox) return { name: ua.includes('FxiOS') ? 'firefox_ios' : 'firefox', version: major(firefox[1]) };
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/);
  if (chrome) return { name: ua.includes('CriOS') ? 'chrome_ios' : 'chrome', version: major(chrome[1]) };
  const safari = ua.match(/Version\/(\d+(?:\.\d+)*).*Safari\//);
  if (safari) return { name: 'safari', version: major(safari[1]) };
  return { name: 'unknown', version: null };
}

function major(version) {
  const parsed = Number.parseInt(version, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createBrowserHost(win) {
  const doc = win.document;
  const nav = win.navigator || {};
  const ua = nav.userAgent || '';
  const browser = detectBrowser(ua);
  return {
    runtime: 'browser',
    global: win,
    ua,
    browser,
    secureContext: win.isSecureContext === true ||
      (win.location && /^https:$|^file:$/.test(win.location.protocol || '')) || false,
    url: win.location ? win.location.href : '',
    platform: nav.platform || '',
    language: nav.language || '',
    online: nav.onLine !== false,
    timing: () => (win.performance && typeof win.performance.now === 'function')
      ? win.performance.now()
      : Date.now(),
    delay: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
    documentPolicy: () => readDocumentPolicy(win, doc),
    crossOriginIsolated: () => win.crossOriginIsolated === true
  };
}

export function createNodeHost() {
  return {
    runtime: 'node',
    global: globalThis,
    ua: '',
    browser: { name: 'node', version: null },
    secureContext: false,
    url: '',
    platform: process.platform,
    language: 'en',
    online: true,
    timing: () => Number(process.hrtime.bigint() / 1000000n),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    documentPolicy: () => ({ coop: null, coep: null, corp: null, coopReportOnly: null, coepReportOnly: null }),
    crossOriginIsolated: () => false
  };
}

export function createHost(win) {
  if (win && win.navigator) return createBrowserHost(win);
  return createNodeHost();
}

function readDocumentPolicy(win, doc) {
  const result = {
    coop: null,
    coep: null,
    corp: null,
    coopReportOnly: null,
    coepReportOnly: null
  };
  try {
    if (doc && typeof doc.querySelectorAll === 'function') {
      doc.querySelectorAll('meta[http-equiv]').forEach((el) => {
        const header = String(el.getAttribute('http-equiv') || '').toLowerCase();
        applyHeader(result, header, el.getAttribute('content') || '');
      });
    }
  } catch {
    /* meta 读取失败时保留 null，由响应头探测补充 */
  }
  if (win.__COI_HEADERS__ && typeof win.__COI_HEADERS__ === 'object') {
    Object.keys(win.__COI_HEADERS__).forEach((header) => {
      applyHeader(result, header.toLowerCase(), win.__COI_HEADERS__[header]);
    });
  }
  return result;
}

export function applyHeader(policy, header, value) {
  header = String(header || '').toLowerCase();
  const content = String(value || '').trim();
  if (!content) return;
  const directive = content.split(';')[0].trim().toLowerCase();
  if (header === 'cross-origin-opener-policy') {
    policy.coop = directive;
  } else if (header === 'cross-origin-embedder-policy') {
    policy.coep = directive;
  } else if (header === 'cross-origin-resource-policy') {
    policy.corp = directive;
  } else if (header === 'cross-origin-opener-policy-report-only') {
    policy.coopReportOnly = directive;
  } else if (header === 'cross-origin-embedder-policy-report-only') {
    policy.coepReportOnly = directive;
  }
}
