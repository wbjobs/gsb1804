// 降级分层引擎：根据检测报告选出可用能力档，并提供：
// 1) BufferChannel —— 统一的缓冲处理通道（共享 / 转移 / 克隆 / 主线程分块）；
// 2) KVStore       —— 统一键值存储（IndexedDB → localStorage → 内存）。
import { Util } from './util.js';

export const TIERS = [
  {
    level: 1,
    key: 'sab-worker',
    title: 'SAB + Worker（零拷贝共享）',
    needs: ['cross_origin_isolated', 'sab', 'worker'],
    desc: '跨源隔离 + SharedArrayBuffer + Atomics + Worker，多线程零拷贝，主线程不阻塞。',
  },
  {
    level: 2,
    key: 'transferable',
    title: 'Transferable + Worker（零拷贝转移）',
    needs: ['worker', 'transferable'],
    desc: 'ArrayBuffer 通过 transfer 交给 Worker，所有权单向转移，无共享但仍零拷贝。',
  },
  {
    level: 3,
    key: 'structured-clone',
    title: '结构化克隆（拷贝到 Worker）',
    needs: ['worker'],
    desc: '普通对象/ArrayBuffer 拷贝传递，数据量大时有序列化开销，需分块。',
  },
  {
    level: 4,
    key: 'main-chunked',
    title: '主线程分块处理',
    needs: [],
    desc: '无 Worker 时用 requestIdleCallback/setTimeout 分块，避免长时间阻塞渲染。',
  },
  {
    level: 5,
    key: 'in-memory',
    title: '内存存储（无持久化）',
    needs: [],
    desc: 'IndexedDB/localStorage 均不可用时仅在会话内存活，刷新丢失并明确提示。',
  },
];

export const Fallback = {
  selectTier(report) {
    const statusOf = (id) => report.results.find((r) => r.id === id)?.status;
    const ok = (id) => statusOf(id) === 'supported';
    if (ok('cross_origin_isolated') && ok('sab') && ok('worker')) return 1;
    if (ok('worker') && ok('transferable')) return 2;
    if (ok('worker')) return 3;
    if (['supported', 'partial'].includes(statusOf('idb'))) return 4;
    return 5;
  },

  tierInfo(level) {
    return TIERS.find((t) => t.level === level) || TIERS[TIERS.length - 1];
  },

  // 未满足的能力 → 配置/选型建议
  gaps(report) {
    const statusOf = (id) => report.results.find((r) => r.id === id)?.status || 'unsupported';
    const tips = [];
    if (statusOf('cross_origin_isolated') !== 'supported') {
      tips.push({
        fix: '发送 COOP/COEP 响应头',
        detail:
          '顶层文档需同时设置 Cross-Origin-Opener-Policy: same-origin 与 ' +
          'Cross-Origin-Embedder-Policy: require-corp；第三方资源须补 CORP/crossorigin 或改用同源代理。',
      });
    }
    if (statusOf('secure_context') !== 'supported') {
      tips.push({ fix: '升级到 HTTPS', detail: '非安全上下文浏览器会隐藏 SharedArrayBuffer；localhost 例外。' });
    }
    if (statusOf('sab') === 'supported' && statusOf('cross_origin_isolated') !== 'supported') {
      tips.push({ fix: 'SAB 仅部分可用', detail: '旧版浏览器在未隔离时仍暴露 SAB 构造器，但不能共享到 Worker，不能视为第 1 档。' });
    }
    if (statusOf('idb') !== 'supported') {
      tips.push({ fix: '持久化降级', detail: 'IndexedDB 不可用（隐私模式？）→ localStorage / 内存，并提示用户数据不持久。' });
    }
    if (statusOf('broadcast_channel') !== 'supported') {
      tips.push({ fix: '跨标签同步降级', detail: 'BroadcastChannel 不可用 → 使用 window.storage 事件或仅当前标签可见。' });
    }
    return tips;
  },
};

// 统一缓冲通道：同一套 process(buffer) API，内部按档位切换实现。
export class BufferChannel {
  constructor(tier) {
    this.tier = tier;
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async start() {
    if (this.tier <= 3 && typeof Worker === 'function') {
      const url = Util.blobWorkerUrl(WORKER_COMPUTE_SOURCE);
      this.worker = await new Promise((resolve, reject) => {
        const w = new Worker(url);
        const ready = (ev) => {
          if (ev.data?.type === 'ready') {
            w.removeEventListener('error', fail);
            resolve(w);
          }
        };
        const fail = (e) => reject(new Error(e.message || 'compute worker error'));
        w.addEventListener('message', ready);
        w.addEventListener('error', fail);
      });
      this.worker.addEventListener('message', (ev) => {
        const d = ev.data;
        const p = this.pending.get(d.id);
        if (!p) return;
        this.pending.delete(d.id);
        d.error ? p.reject(new Error(d.error)) : p.resolve(d);
      });
    }
  }

  // 返回 { sum, mode, bytesCopied, durationMs }
  async process(byteLength) {
    const started = Util.now();
    if (this.tier === 1) return this._viaSAB(byteLength, started);
    if (this.tier === 2) return this._viaTransfer(byteLength, started);
    if (this.tier === 3) return this._viaClone(byteLength, started);
    return this._viaMain(byteLength, started);
  }

  _ask(data, transfer = []) {
    const id = `c-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...data }, transfer);
    });
  }

  async _viaSAB(byteLength, started) {
    const sab = new SharedArrayBuffer(byteLength);
    new Uint8Array(sab).fill(7);
    const r = await this._ask({ cmd: 'sab', buffer: sab });
    return { sum: r.sum, mode: 'shared (零拷贝共享)', bytesCopied: 0, durationMs: Math.round(Util.now() - started) };
  }

  async _viaTransfer(byteLength, started) {
    const buf = new ArrayBuffer(byteLength);
    new Uint8Array(buf).fill(7);
    const r = await this._ask({ cmd: 'sum', buffer: buf }, [buf]);
    return { sum: r.sum, mode: 'transfer (零拷贝转移)', bytesCopied: 0, durationMs: Math.round(Util.now() - started) };
  }

  async _viaClone(byteLength, started) {
    const buf = new ArrayBuffer(byteLength);
    new Uint8Array(buf).fill(7);
    const r = await this._ask({ cmd: 'sum', buffer: buf }); // 不 transfer → 结构化克隆
    return { sum: r.sum, mode: 'clone (结构化克隆拷贝)', bytesCopied: byteLength, durationMs: Math.round(Util.now() - started) };
  }

  async _viaMain(byteLength, started) {
    const chunkSize = 256 * 1024;
    let sum = 0;
    const run = (offset) =>
      new Promise((resolve) => {
        const end = Math.min(offset + chunkSize, byteLength);
        for (let i = offset; i < end; i++) sum += 7;
        if (end < byteLength) {
          (globalThis.requestIdleCallback || setTimeout)(() => resolve(run(end)), 0);
        } else {
          resolve();
        }
      });
    await run(0);
    return { sum, mode: 'main (主线程分块)', bytesCopied: 0, durationMs: Math.round(Util.now() - started) };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

const WORKER_COMPUTE_SOURCE = `
self.onmessage = (ev) => {
  const d = ev.data;
  try {
    const view = new Uint8Array(d.buffer);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum += view[i];
    self.postMessage({ id: d.id, sum });
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err.message || err) });
  }
};
self.postMessage({ type: 'ready' });
`;

// 统一键值存储：IDB → localStorage → 内存。
export class KVStore {
  constructor(report) {
    const idbStatus = report.results.find((r) => r.id === 'idb')?.status;
    this.backend =
      idbStatus === 'supported' && typeof indexedDB !== 'undefined'
        ? 'idb'
        : typeof localStorage !== 'undefined'
          ? 'localStorage'
          : 'memory';
    this.memory = new Map();
    this.db = null;
    this.notice =
      this.backend === 'memory'
        ? 'IndexedDB/localStorage 均不可用，数据仅存于内存，刷新后丢失。'
        : this.backend === 'localStorage'
          ? 'IndexedDB 不可用，使用 localStorage，容量较小。'
          : '';
  }

  async _db() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('coi-reports', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async set(key, value) {
    const text = JSON.stringify(value);
    if (this.backend === 'idb') {
      const db = await this._db();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(text, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } else if (this.backend === 'localStorage') {
      localStorage.setItem(key, text);
    } else {
      this.memory.set(key, text);
    }
  }

  async get(key) {
    let text;
    if (this.backend === 'idb') {
      const db = await this._db();
      text = await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else if (this.backend === 'localStorage') {
      text = localStorage.getItem(key);
    } else {
      text = this.memory.get(key);
    }
    return text == null ? null : JSON.parse(text);
  }

  async keys() {
    if (this.backend === 'idb') {
      const db = await this._db();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    if (this.backend === 'localStorage') {
      return Object.keys(localStorage).filter((k) => k.startsWith('coi-report:'));
    }
    return [...this.memory.keys()];
  }

  async delete(key) {
    if (this.backend === 'idb') {
      const db = await this._db();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } else if (this.backend === 'localStorage') {
      localStorage.removeItem(key);
    } else {
      this.memory.delete(key);
    }
  }
}
