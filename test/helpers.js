export function createFakeWindow(overrides = {}) {
  const listeners = new Map();
  const timers = new Map();
  let timerSeq = 1;
  const win = {
    isSecureContext: overrides.isSecureContext !== false,
    location: { href: overrides.url || 'https://example.test/app', protocol: 'https:' },
    navigator: {
      userAgent: overrides.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64',
      language: 'zh-CN',
      onLine: true,
      storage: overrides.storageEstimate ? { estimate: async () => overrides.storageEstimate } : undefined
    },
    performance: { now: () => Date.now() },
    setTimeout: (fn, ms, ...args) => {
      const id = timerSeq++;
      timers.set(id, setTimeout(() => { timers.delete(id); fn(...args); }, ms));
      return id;
    },
    clearTimeout: (id) => {
      if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
    },
    console,
    HTMLElement: class {},
    URL: Object.assign(class URLStub {}, URL, {
      createObjectURL: (blob) => `blob:fake/${Math.random().toString(36).slice(2)}`,
      revokeObjectURL: () => {}
    }),
    Blob: overrides.blob === false ? undefined : class Blob {
      constructor(parts, options) { this.parts = parts; this.type = options && options.type; }
    },
    SharedArrayBuffer: overrides.sab === false ? undefined : (globalThis.SharedArrayBuffer || fakeSAB()),
    Atomics: overrides.atomics === false ? undefined : (globalThis.Atomics || fakeAtomics()),
    Worker: overrides.worker === false ? undefined : FakeWorker,
    SharedWorker: overrides.sharedWorker === false ? undefined : FakeSharedWorker,
    indexedDB: overrides.indexedDB,
    fetch: overrides.fetch,
    __COI_HEADERS__: overrides.headers || null,
    document: overrides.document === false ? undefined : createFakeDocument(overrides),
    crossOriginIsolated: overrides.crossOriginIsolated === true
  };
  win.global = win;
  return win;
}

function createFakeDocument(overrides) {
  const iframe = { setAttribute() {}, hasAttribute: () => true, allow: '' };
  return {
    featurePolicy: overrides.featurePolicy === false ? undefined : {
      allowedFeatures: () => ['cross-origin-isolation', 'sync-xhr'],
      allowsFeature: (name) => name === 'cross-origin-isolation'
    },
    permissionsPolicy: overrides.permissionsPolicy === false ? undefined : {
      allowedFeatures: () => ['cross-origin-isolation'],
      allowsFeature: (name) => name === 'cross-origin-isolation'
    },
    querySelectorAll: () => overrides.metaPolicies || [],
    createElement: () => iframe,
    body: { appendChild() {}, removeChild() {} }
  };
}

function fakeSAB() {
  class FakeSharedArrayBuffer {
    constructor(length) { this.byteLength = length; this._buf = new ArrayBuffer(length); }
  }
  return FakeSharedArrayBuffer;
}

function fakeAtomics() {
  return {
    store(view, index, value) { view[index] = value; return value; },
    add(view, index, delta) { const old = view[index]; view[index] += delta; return old; },
    compareExchange(view, index, expected, replacement) {
      const current = view[index];
      if (current === expected) view[index] = replacement;
      return current;
    },
    wait() { return 'not-equal'; }
  };
}

export class FakeWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (list) {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
  }
  postMessage(message) {
    const listeners = this.listeners.get('message') || [];
    queueMicrotask(() => {
      listeners.forEach((fn) => fn({ data: respond(message) }));
    });
  }
  terminate() { this.terminated = true; }
}

export class FakeSharedWorker {
  constructor(url) {
    this.url = url;
    this.port = new FakeWorker(url);
    this.port.close = () => { this.port.closed = true; };
    this.port.start = () => {};
  }
}

function respond(message) {
  const env = {
    crossOriginIsolated: false,
    hasSharedArrayBuffer: true,
    hasAtomics: true,
    hasIndexedDB: true,
    importScriptsSupported: true,
    location: 'blob:fake'
  };
  if (message.cmd === 'env') return { id: message.id, ok: true, result: env };
  if (message.cmd === 'sab') return { id: message.id, ok: true, result: { env, sab: { ok: true, byteLength: 16, waitResult: 'timed-out' } } };
  if (message.cmd === 'idb') return { id: message.id, ok: true, result: { ok: true } };
  return { id: message.id, ok: false, error: 'UNKNOWN_CMD' };
}

export function createFakeIndexedDB(mode = 'ok') {
  function requestStore() {
    const finish = () => queueMicrotask(() => {
      if (mode === 'tx-fail') storeObj._tx.onerror && storeObj._tx.onerror({ target: storeObj._tx });
      else storeObj._tx.oncomplete && storeObj._tx.oncomplete({ target: storeObj._tx });
    });
    const storeObj = {
      _values: new Map(),
      _tx: null,
      put(value, key) { if (mode === 'quota') throw quotaError(); this._values.set(key, value); finish(); return {}; },
      get(key) {
        const req = { onsuccess: null, onerror: null, result: undefined };
        queueMicrotask(() => {
          req.result = this._values.get(key);
          req.onsuccess && req.onsuccess({ target: req });
        });
        return req;
      },
      delete(key) { this._values.delete(key); finish(); return {}; }
    };
    return storeObj;
  }
  function Request(execute) {
    const req = {
      result: undefined,
      error: mode === 'fail' ? new Error('fake open failure') : undefined,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null
    };
    queueMicrotask(() => {
      if (mode === 'fail') {
        req.onerror && req.onerror({ target: req });
        return;
      }
      if (mode === 'blocked') {
        req.onblocked && req.onblocked({ target: req });
        return;
      }
      const stores = new Map();
      req.result = {
        objectStoreNames: { contains: (name) => stores.has(name) },
        createObjectStore(name) { stores.set(name, requestStore()); },
        close() {},
        onversionchange: null,
        transaction(storeName, txMode) {
          if (!stores.has(storeName)) stores.set(storeName, requestStore());
          const store = stores.get(storeName);
          const tx = {
            error: mode === 'tx-fail' ? new Error('fake tx failure') : undefined,
            oncomplete: null,
            onerror: null,
            onabort: null,
            abort() {},
            objectStore: () => store
          };
          store._tx = tx;
          return tx;
        }
      };
      if (mode !== 'existing') {
        req.onupgradeneeded && req.onupgradeneeded({ target: req });
      }
      req.onsuccess && req.onsuccess({ target: req });
    });
    return req;
  }
  return { open: (name, version) => Request({ name, version }) };
}

function quotaError() {
  const error = new Error('QuotaExceededError: fake quota');
  error.name = 'QuotaExceededError';
  return error;
}

export { respond as workerRespond };
