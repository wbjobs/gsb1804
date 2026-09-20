export const BROWSERS = [
  { key: 'chrome', label: 'Chrome (桌面/Android)' },
  { key: 'edge', label: 'Edge (Chromium)' },
  { key: 'firefox', label: 'Firefox' },
  { key: 'safari', label: 'Safari (macOS/iPadOS)' },
  { key: 'samsung', label: 'Samsung Internet' },
  { key: 'opera', label: 'Opera' }
];

export const FEATURES = [
  { key: 'coop', label: 'COOP (same-origin)' },
  { key: 'coep', label: 'COEP require-corp' },
  { key: 'coep_credentialless', label: 'COEP credentialless' },
  { key: 'corp', label: 'CORP 响应头' },
  { key: 'crossOriginIsolated', label: 'self.crossOriginIsolated' },
  { key: 'sab', label: 'SharedArrayBuffer (隔离后)' },
  { key: 'atomics_wait_async', label: 'Atomics.waitAsync' },
  { key: 'feature_policy', label: 'Feature Policy (旧版)' },
  { key: 'permissions_policy', label: 'Permissions Policy (新版)' },
  { key: 'worker', label: 'Web Worker (经典)' },
  { key: 'module_worker', label: 'Module Worker' },
  { key: 'shared_worker', label: 'SharedWorker' },
  { key: 'idb', label: 'IndexedDB' },
  { key: 'idb_worker', label: 'Worker 内 IndexedDB' }
];

export const MATRIX = {
  source: 'MDN / caniuse / Chromium/webkit 发布记录整理',
  lastReviewed: '2024-2025 年公开资料',
  note: '版本号为首次默认启用的大版本；标记 ~ 的单元格存在灰度/平台差异，请以实时特性检测为准。',
  references: [
    { title: 'MDN: Cross-Origin-Opener-Policy', url: 'https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy' },
    { title: 'MDN: Cross-Origin-Embedder-Policy', url: 'https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy' },
    { title: 'MDN: Cross-Origin-Resource-Policy', url: 'https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy' },
    { title: 'MDN: SharedArrayBuffer', url: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer' },
    { title: 'web.dev: cross-origin isolation guide', url: 'https://web.dev/articles/cross-origin-isolation-guide' }
  ],
  rows: [
    {
      feature: 'coop',
      chrome: { min: 83, note: '' },
      edge: { min: 83, note: '' },
      firefox: { min: 79, note: '' },
      safari: { min: 15.2, note: 'Safari 15.2' },
      samsung: { min: 13, note: '约 v13，对应 Chromium 83+', approx: true },
      opera: { min: 69, note: 'Chromium 83 对应 Opera 69', approx: true }
    },
    {
      feature: 'coep',
      chrome: { min: 83, note: '' },
      edge: { min: 83, note: '' },
      firefox: { min: 79, note: '' },
      safari: { min: 15.2, note: '' },
      samsung: { min: 13, note: '约 v13', approx: true },
      opera: { min: 69, note: '约 Opera 69', approx: true }
    },
    {
      feature: 'coep_credentialless',
      chrome: { min: 96, note: 'Chrome 96+，逐步转正' },
      edge: { min: 96, note: '' },
      firefox: { min: null, note: '不支持；需回退 require-corp' },
      safari: { min: null, note: '不支持；需回退 require-corp' },
      samsung: { min: 16, note: '随 Chromium 内核，约 v16+', approx: true },
      opera: { min: 82, note: '随 Chromium 96，约 Opera 82', approx: true }
    },
    {
      feature: 'corp',
      chrome: { min: 73, note: '' },
      edge: { min: 79, note: 'Chromium 版 Edge 起' },
      firefox: { min: 74, note: '' },
      safari: { min: 12.1, note: 'Safari 12.1' },
      samsung: { min: 11, note: '随 Chromium 73', approx: true },
      opera: { min: 60, note: '随 Chromium 73，约 Opera 60', approx: true }
    },
    {
      feature: 'crossOriginIsolated',
      chrome: { min: 87, note: '' },
      edge: { min: 87, note: '' },
      firefox: { min: 79, note: '' },
      safari: { min: 15.2, note: '' },
      samsung: { min: 14, note: '随 Chromium 87', approx: true },
      opera: { min: 73, note: '随 Chromium 87，约 Opera 73', approx: true }
    },
    {
      feature: 'sab',
      chrome: { min: 88, note: '桌面 Chrome 79 曾恢复、88 全量；Android Chrome 88' },
      edge: { min: 88, note: '桌面 79/全量 88' },
      firefox: { min: 79, note: '' },
      safari: { min: 15.2, note: 'macOS 12/iOS 15.2 起' },
      samsung: { min: 14, note: '随 Chromium 88，约 v14', approx: true },
      opera: { min: 74, note: '随 Chromium 88，约 Opera 74', approx: true }
    },
    {
      feature: 'atomics_wait_async',
      chrome: { min: 87, note: '' },
      edge: { min: 87, note: '' },
      firefox: { min: null, note: '长期未默认支持，按特性检测降级' },
      safari: { min: null, note: '以实时检测为准', approx: true },
      samsung: { min: 14, note: '随 Chromium 87', approx: true },
      opera: { min: 73, note: '约 Opera 73', approx: true }
    },
    {
      feature: 'feature_policy',
      chrome: { min: 60, note: '' },
      edge: { min: 79, note: '' },
      firefox: { min: 74, note: '部分策略支持；以检测为准' },
      safari: { min: 11.1, note: '部分策略；以检测为准', approx: true },
      samsung: { min: 8, note: '随 Chromium 60', approx: true },
      opera: { min: 47, note: '约 Opera 47', approx: true }
    },
    {
      feature: 'permissions_policy',
      chrome: { min: 88, note: 'document.permissionsPolicy 逐步替换' },
      edge: { min: 88, note: '' },
      firefox: { min: null, note: '支持的策略面有限，以检测为准', approx: true },
      safari: { min: null, note: '以实时检测为准', approx: true },
      samsung: { min: 14, note: '随 Chromium 88', approx: true },
      opera: { min: 74, note: '约 Opera 74', approx: true }
    },
    {
      feature: 'worker',
      chrome: { min: 4, note: '' },
      edge: { min: 12, note: '' },
      firefox: { min: 3, note: '' },
      safari: { min: 4, note: '' },
      samsung: { min: 4, note: '' },
      opera: { min: 10.6, note: '' }
    },
    {
      feature: 'module_worker',
      chrome: { min: 80, note: '' },
      edge: { min: 80, note: '' },
      firefox: { min: 114, note: 'Firefox 114' },
      safari: { min: 15, note: 'Safari 15', approx: true },
      samsung: { min: 13, note: '随 Chromium 80', approx: true },
      opera: { min: 67, note: '约 Opera 67', approx: true }
    },
    {
      feature: 'shared_worker',
      chrome: { min: 4, note: '' },
      edge: { min: 79, note: '旧 Edge 不支持；Chromium 版起支持' },
      firefox: { min: 29, note: '' },
      safari: { min: 16, note: 'Safari 16 才默认支持；iOS 历史上长期不可用' },
      samsung: { min: 4, note: '' },
      opera: { min: 10.6, note: '' }
    },
    {
      feature: 'idb',
      chrome: { min: 24, note: '' },
      edge: { min: 12, note: '' },
      firefox: { min: 16, note: '' },
      safari: { min: 10.1, note: 'iOS 10.1；隐私模式历史受限' },
      samsung: { min: 4, note: '' },
      opera: { min: 15, note: '' }
    },
    {
      feature: 'idb_worker',
      chrome: { min: 24, note: '' },
      edge: { min: 79, note: '以 Chromium 版为准', approx: true },
      firefox: { min: 37, note: '' },
      safari: { min: 10.1, note: '可用性随平台变化，以 Worker 探针为准', approx: true },
      samsung: { min: 4, note: '随内核，以探针为准', approx: true },
      opera: { min: 15, note: '', approx: true }
    }
  ]
};
