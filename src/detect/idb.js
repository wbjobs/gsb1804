import { SUPPORT } from '../core/model.js';
import { ProbeError, ERROR_CODES } from '../core/errors.js';

const DB_NAME = '__coi_capability_probe__';
const STORE = 'probe';
const DB_VERSION = 1;

export function createIdbDetector(options = {}) {
  return async function detectIdb(host) {
    const target = host.global;
    if (host.runtime !== 'browser' || typeof target.indexedDB !== 'object' || !target.indexedDB) {
      return {
        support: SUPPORT.UNSUPPORTED,
        details: {
          indexedDBExists: typeof target.indexedDB !== 'undefined',
          crudVerified: false,
          storageEstimate: null
        },
        warnings: ['IndexedDB 不可用，报告与缓存将使用内存/导出文件降级']
      };
    }
    const warnings = [];
    let estimate = null;
    try {
      if (target.navigator && target.navigator.storage && typeof target.navigator.storage.estimate === 'function') {
        estimate = await target.navigator.storage.estimate();
        if (estimate && estimate.quota && estimate.usage / estimate.quota > 0.95) {
          warnings.push('存储配额接近用尽，持久化报告可能失败');
        }
      }
    } catch {
      warnings.push('storage.estimate() 调用失败，跳过配额检查');
    }
    try {
      const idbFactory = options.idbFactory || target.indexedDB;
      await runCrudSelfTest(target, idbFactory, options.timeoutMs || 4000);
      return {
        support: SUPPORT.SUPPORTED,
        details: {
          indexedDBExists: true,
          crudVerified: true,
          storageEstimate: estimate ? { quota: estimate.quota, usage: estimate.usage } : null
        },
        warnings
      };
    } catch (error) {
      return {
        support: SUPPORT.ERROR,
        details: {
          indexedDBExists: true,
          crudVerified: false,
          storageEstimate: estimate ? { quota: estimate.quota, usage: estimate.usage } : null
        },
        error: { code: error.code || ERROR_CODES.STORAGE_UNAVAILABLE, message: error.message },
        warnings: [...warnings, `IndexedDB 自检失败: ${error.message}`]
      };
    }
  };
}

function runCrudSelfTest(target, factory, timeoutMs) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const timer = target.setTimeout(() => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, `IndexedDB 自检在 ${timeoutMs}ms 后超时`)), timeoutMs);
    function done(callback) {
      if (settled) return;
      settled = true;
      target.clearTimeout(timer);
      callback();
    }
    function fail(error) {
      done(() => reject(error));
    }
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, `indexedDB.open 抛出异常: ${error.message || error}`, error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onerror = () => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE,
      `数据库打开失败: ${request.error && request.error.message || '未知错误'}`, request.error));
    request.onblocked = () => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '数据库升级被其他标签页阻塞'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { try { db.close(); } catch { /* 忽略 */ } };
      let tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (error) {
        fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, `创建事务失败: ${error.message}`, error));
        return;
      }
      const payload = { v: 1, at: new Date().toISOString() };
      tx.objectStore(STORE).put(payload, 'selftest');
      tx.oncomplete = () => {
        let readTx;
        try {
          readTx = db.transaction(STORE, 'readonly');
        } catch (error) {
          fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, error.message, error));
          return;
        }
        const getReq = readTx.objectStore(STORE).get('selftest');
        getReq.onerror = () => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '读取自检记录失败'));
        getReq.onsuccess = () => {
          const value = getReq.result;
          if (!value || value.v !== 1) {
            fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '自检记录写入后读取不一致'));
            return;
          }
          let delTx;
          try {
            delTx = db.transaction(STORE, 'readwrite');
            delTx.objectStore(STORE).delete('selftest');
          } catch (error) {
            fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, error.message, error));
            return;
          }
          delTx.oncomplete = () => done(() => { try { db.close(); } finally { resolve(true); } });
          delTx.onerror = () => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '清理自检记录失败'));
        };
      };
      tx.onerror = () => fail(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE,
        `写入失败: ${tx.error && tx.error.message || ''}`, tx.error));
      tx.onabort = () => fail(new ProbeError(ERROR_CODES.STORAGE_QUOTA,
        `事务中止: ${tx.error && tx.error.message || '可能触发配额限制'}`, tx.error));
    };
  });
}
