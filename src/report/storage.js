import { ProbeError, ERROR_CODES } from '../core/errors.js';

const DB_NAME = '__coi_reports__';
const STORE = 'reports';
const VERSION = 1;
const KEY = 'latest';

export function createReportStore(host, options = {}) {
  const target = host.global;
  const idbAvailable = host.runtime === 'browser' &&
    typeof target.indexedDB === 'object' && target.indexedDB !== null &&
    options.mode !== 'memory';
  if (idbAvailable) {
    return idbStore(target, options);
  }
  return memoryStore('IndexedDB 不可用，自动切换内存存储');
}

function idbStore(target, options) {
  const memory = new Map();
  const dbName = options.dbName || DB_NAME;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = target.indexedDB.open(dbName, VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE,
          `报告数据库打开失败: ${request.error && request.error.message || ''}`, request.error));
        request.onblocked = () => reject(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '报告数据库升级被阻塞'));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function tx(storeName, mode, worker) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new ProbeError(
        transaction.error && /quota/i.test(transaction.error.message || '')
          ? ERROR_CODES.STORAGE_QUOTA
          : ERROR_CODES.STORAGE_UNAVAILABLE,
        `报告存储事务失败: ${transaction.error && transaction.error.message || ''}`,
        transaction.error));
      transaction.onabort = () => reject(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, '报告存储事务被中止'));
      try {
        worker(transaction.objectStore(storeName), transaction);
      } catch (error) {
        reject(new ProbeError(ERROR_CODES.STORAGE_UNAVAILABLE, error.message, error));
      }
    });
  }

  return {
    backend: 'indexeddb',
    async save(report) {
      const record = { report, savedAt: new Date().toISOString() };
      try {
        await tx(STORE, 'readwrite', (store) => store.put(record, KEY));
      } catch (error) {
        memory.set(KEY, record);
        const code = error.code === ERROR_CODES.STORAGE_UNAVAILABLE
          ? ERROR_CODES.STORAGE_UNAVAILABLE
          : ERROR_CODES.STORAGE_QUOTA;
        throw new ProbeError(code,
          `IndexedDB 写入失败，已暂存内存: ${error.message}`, error);
      }
      memory.set(KEY, record);
      return { backend: 'indexeddb', key: KEY };
    },
    async load() {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readonly');
          const request = transaction.objectStore(STORE).get(KEY);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        return memory.get(KEY) || null;
      }
    },
    async clear() {
      memory.clear();
      try {
        await tx(STORE, 'readwrite', (store) => store.delete(KEY));
      } catch {
        /* 内存副本已清理，数据库清理失败不阻断 */
      }
    }
  };
}

export function memoryStore(reason) {
  const map = new Map();
  return {
    backend: 'memory',
    reason,
    async save(report) {
      map.set(KEY, { report, savedAt: new Date().toISOString() });
      return { backend: 'memory', key: KEY };
    },
    async load() {
      return map.get(KEY) || null;
    },
    async clear() {
      map.clear();
    }
  };
}
