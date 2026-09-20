// 兼容矩阵：内置“参考数据”（来源 MDN / 浏览器发布记录，快照 2025-09），
// 运行时与实机检测结果合并。实机检测始终是权威结论；参考数据仅用于对照。
// 版本号表示“最低支持版本”；null 表示无支持；不确定的标 null 并在 note 说明。

export const MATRIX_META = {
  snapshot: '2025-09',
  sources: [
    'https://developer.mozilla.org/docs/Web/API/Window/crossOriginIsolated',
    'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy',
    'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy',
    'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy',
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer',
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync',
    'https://developer.mozilla.org/docs/Web/API/Worker/Worker#type',
  ],
  disclaimer:
    '参考版本可能随浏览器更新变化；本页“实机”列才是当前环境的权威结论。SAB 在 Chrome 87 起要求跨源隔离。',
};

export const BROWSERS = ['chrome', 'edge', 'firefox', 'safari'];

export const BROWSER_LABELS = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
};

// min: 最低支持版本；null = 不支持/未确认；值为数字。
// flags 备注特殊启用条件（如 origin trial / 标志位 / 平台差异）。
export const MATRIX = [
  {
    id: 'secure_context',
    name: '安全上下文要求',
    group: '基础环境',
    min: { chrome: 0, edge: 0, firefox: 0, safari: 0 },
    note: '所有现代浏览器均支持 isSecureContext；localhost 视为安全。',
  },
  {
    id: 'cross_origin_isolated',
    name: 'crossOriginIsolated',
    group: '隔离',
    min: { chrome: 87, edge: 87, firefox: 72, safari: 15.2 },
    note: '需 COOP: same-origin + COEP: require-corp 同时生效才为 true。',
  },
  {
    id: 'sab',
    name: 'SharedArrayBuffer（隔离后）',
    group: '隔离',
    min: { chrome: 87, edge: 87, firefox: 79, safari: 15.2 },
    note: '桌面 Chrome 早期曾默认开放；87 起要求跨源隔离。Firefox 79+ 在隔离页面启用。',
  },
  {
    id: 'atomics',
    name: 'Atomics（含 waitAsync）',
    group: '隔离',
    min: { chrome: 68, edge: 79, firefox: 78, safari: 15.2 },
    note: 'Atomics.waitAsync 仅 Chrome/Edge 87+；Firefox/Safari 未确认支持，以实测为准。',
    waitAsync: { chrome: 87, edge: 87, firefox: null, safari: null },
  },
  {
    id: 'coop_inference',
    name: 'COOP 响应头',
    group: '策略',
    min: { chrome: 83, edge: 83, firefox: 79, safari: 15.2 },
    note: 'same-origin / same-origin-allow-popups 语义；JS 不可直接读取，只能间接验证。',
  },
  {
    id: 'coep_inference',
    name: 'COEP 响应头',
    group: '策略',
    min: { chrome: 83, edge: 83, firefox: 79, safari: 15.2 },
    note: 'require-corp；Chrome 96+ 另有 credentialless（非标准，兼容矩阵中不计为通用方案）。',
  },
  {
    id: 'corp_header_support',
    name: 'CORP 响应头识别',
    group: '策略',
    min: { chrome: 73, edge: 79, firefox: 74, safari: 12.1 },
    note: 'same-origin / same-site / cross-origin；由浏览器在加载时强制执行，无 JS API。',
  },
  {
    id: 'feature_policy_api',
    name: 'document.featurePolicy / permissionsPolicy',
    group: '策略',
    min: { chrome: 74, edge: 79, firefox: null, safari: null },
    note: 'featurePolicy 为 Chromium 私有 API；permissionsPolicy 为新标准命名；Firefox/Safari 未确认，以实测为准。',
  },
  {
    id: 'reporting_observer',
    name: 'ReportingObserver API',
    group: '策略',
    min: { chrome: 69, edge: 79, firefox: null, safari: null },
    note: '仅 Chromium 系；其他浏览器用 Reporting-Endpoints 服务端收集。',
  },
  {
    id: 'worker',
    name: 'Web Worker（经典）',
    group: 'Worker',
    min: { chrome: 4, edge: 12, firefox: 3.5, safari: 4 },
    note: 'Blob Worker 在隔离页面继承 COEP，可正常创建。',
  },
  {
    id: 'module_worker',
    name: 'Module Worker（type:"module"）',
    group: 'Worker',
    min: { chrome: 80, edge: 80, firefox: 114, safari: 15 },
    note: '历史兼容差异大；Firefox/Safari 旧版本不支持，务必以本页实测为准。',
  },
  {
    id: 'idb',
    name: 'IndexedDB',
    group: '存储',
    min: { chrome: 24, edge: 12, firefox: 16, safari: 10.1 },
    note: '隐私模式下可能被禁用（此时检测报 error 并降级 localStorage/内存）。',
  },
  {
    id: 'idb_sab',
    name: 'SAB 结构化克隆进 IDB',
    group: '存储',
    min: { chrome: 87, edge: 87, firefox: 79, safari: 15.2 },
    note: '随 SAB/跨源隔离一起开放；非隔离环境跳过该项。',
  },
  {
    id: 'transferable',
    name: 'postMessage Transferable',
    group: '传输',
    min: { chrome: 17, edge: 12, firefox: 18, safari: 10.1 },
    note: 'ArrayBuffer/MessagePort 等可转移，转移后原上下文失效。',
  },
  {
    id: 'message_channel',
    name: 'MessageChannel / 结构化克隆',
    group: '传输',
    min: { chrome: 2, edge: 12, firefox: 41, safari: 5 },
    note: '结构化克隆覆盖普通对象与 ArrayBuffer（拷贝语义）。',
  },
  {
    id: 'broadcast_channel',
    name: 'BroadcastChannel',
    group: '传输',
    min: { chrome: 54, edge: 79, firefox: 38, safari: 15.4 },
    note: '用于报告历史的跨标签实时同步；不可用时退化为 storage 事件。',
  },
];

export function detectBrowser(ua = navigator.userAgent) {
  const u = ua || '';
  const versionOf = (re) => {
    const m = u.match(re);
    return m ? Number(m[1]) : null;
  };
  if (/\bEdg\/(\d+)/.test(u)) return { key: 'edge', version: versionOf(/\bEdg\/(\d+)/) };
  if (/\bOPR\/(\d+)/.test(u)) return { key: 'chrome', version: versionOf(/\bOPR\/(\d+)/), alt: 'Opera' };
  if (/Chrome\/(\d+)/.test(u)) return { key: 'chrome', version: versionOf(/Chrome\/(\d+)/) };
  if (/Firefox\/(\d+)/.test(u)) return { key: 'firefox', version: versionOf(/Firefox\/(\d+)/) };
  if (/Version\/(\d+[.\d]*) .*Safari/.test(u)) return { key: 'safari', version: versionOf(/Version\/(\d+)/) };
  return { key: 'unknown', version: null };
}

// 将检测结果与参考矩阵合并，产出渲染用行模型。
export function buildMatrixRows(report) {
  const byId = new Map((report.results || []).map((r) => [r.id, r]));
  const ua = detectBrowser(report.env?.userAgent);
  return MATRIX.map((row) => {
    const live = byId.get(row.id);
    return {
      ...row,
      liveStatus: live?.status ?? 'untested',
      liveDetail: live?.detail ?? '',
      currentBrowser: ua.key,
      currentVersion: ua.version,
      liveMeetsReference: ua.key === 'unknown' || !ua.version ? null : meetsRef(row, ua),
    };
  });
}

function meetsRef(row, ua) {
  const min = row.min?.[ua.key];
  if (min == null) return null;
  return ua.version >= min;
}
