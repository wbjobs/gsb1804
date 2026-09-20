
'use strict';
(function () {
  function envInfo() {
    return {
      crossOriginIsolated: typeof self.crossOriginIsolated === 'boolean' ? self.crossOriginIsolated : false,
      hasSharedArrayBuffer: typeof self.SharedArrayBuffer === 'function',
      hasAtomics: typeof self.Atomics === 'object' && self.Atomics !== null,
      hasIndexedDB: typeof self.indexedDB === 'object' && self.indexedDB !== null,
      importScriptsSupported: typeof self.importScripts === 'function',
      location: self.location ? self.location.href : ''
    };
  }

  function sabRoundtrip() {
    if (typeof self.SharedArrayBuffer !== 'function' || typeof self.Atomics !== 'object') {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    var buffer;
    try {
      buffer = new self.SharedArrayBuffer(16);
    } catch (error) {
      return { ok: false, reason: 'CONSTRUCT_THREW', message: String(error && error.message || error) };
    }
    try {
      var view = new Int32Array(buffer);
      self.Atomics.store(view, 0, 7);
      var woken = self.Atomics.wait(view, 1, 0, 1);
      return {
        ok: self.Atomics.add(view, 0, 35) === 7,
        byteLength: buffer.byteLength,
        waitResult: woken
      };
    } catch (error) {
      return { ok: false, reason: 'ATOMICS_FAILED', message: String(error && error.message || error) };
    }
  }

  function openIndexedDB() {
    return new Promise(function (resolve) {
      if (typeof self.indexedDB !== 'object' || !self.indexedDB) {
        resolve({ ok: false, reason: 'UNAVAILABLE' });
        return;
      }
      var request;
      try {
        request = self.indexedDB.open('__coi_probe__', 1);
      } catch (error) {
        resolve({ ok: false, reason: 'OPEN_THREW', message: String(error && error.message || error) });
        return;
      }
      var settled = false;
      function finish(payload) {
        if (settled) return;
        settled = true;
        try {
          if (request.result && typeof request.result.close === 'function') request.result.close();
          if (request.transaction && typeof request.transaction.abort === 'function') {
            try { request.transaction.abort(); } catch (_) { /* 无活动事务时忽略 */ }
          }
        } catch (_) { /* 清理失败不影响结论 */ }
        resolve(payload);
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('probe')) db.createObjectStore('probe');
      };
      request.onsuccess = function () {
        var db = request.result;
        try {
          var tx = db.transaction('probe', 'readwrite');
          tx.objectStore('probe').put('ping', 'key');
          tx.oncomplete = function () { finish({ ok: true }); };
          tx.onerror = function () { finish({ ok: false, reason: 'WRITE_FAILED', message: String(tx.error && tx.error.message || '') }); };
          tx.onabort = function () { finish({ ok: false, reason: 'ABORTED', message: String(tx.error && tx.error.message || '') }); };
        } catch (error) {
          finish({ ok: false, reason: 'TRANSACTION_THREW', message: String(error && error.message || error) });
        }
      };
      request.onerror = function () {
        finish({ ok: false, reason: 'OPEN_FAILED', message: String(request.error && request.error.message || '') });
      };
      request.onblocked = function () {
        finish({ ok: false, reason: 'BLOCKED' });
      };
    });
  }

  self.onmessage = function (event) {
    var payload = event.data || {};
    var id = payload.id;
    Promise.resolve()
      .then(function () {
        if (payload.cmd === 'env') return envInfo();
        if (payload.cmd === 'sab') return { env: envInfo(), sab: sabRoundtrip() };
        if (payload.cmd === 'idb') return openIndexedDB();
        if (payload.cmd === 'ping') return { pong: true };
        throw new Error('UNKNOWN_CMD');
      })
      .then(function (result) {
        self.postMessage({ id: id, ok: true, result: result });
      })
      .catch(function (error) {
        self.postMessage({ id: id, ok: false, error: String(error && error.message || error) });
      });
  };
})();
