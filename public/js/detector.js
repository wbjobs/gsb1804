// 特性检测核心：COOP/COEP/CORP、SharedArrayBuffer、Web Worker、IndexedDB 等。
// 每个 check 返回统一结构（makeResult），任何异常都被归一化为 error/skipped，
// 不允许中断整个检测流程。
import { Util, makeResult, severityOf } from './util.js';
import { Fallback } from './fallback.js';

const TIMEOUT_WORKER = 8000;
const TIMEOUT_FETCH = 6000;

const WORKER_SOURCE = `
self.postMessage({ type: 'ready', isolated: self.crossOriginIsolated === true });
self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const reply = (payload) => self.postMessage({ id: msg.id, ...payload });
  try {
    if (msg.cmd === 'ping') {
      reply({ type: 'pong' });
    } else if (msg.cmd === 'sab') {
      const buf = ev.data.buffer;
      if (!(buf instanceof SharedArrayBuffer)) {
        reply({ type: 'error', error: 'Worker 收到的不是 SharedArrayBuffer' });
        return;
      }
      const view = new Int32Array(buf);
      const before = Atomics.load(view, 0);
      Atomics.add(view, 0, 7);
      reply({ type: 'sab-ok', before, after: Atomics.load(view, 0), isolated: self.crossOriginIsolated === true });
    } else if (msg.cmd === 'transfer') {
      reply({ type: 'transfer-ok', byteLength: ev.data.buffer.byteLength });
    }
  } catch (err) {
    reply({ type: 'error', error: String(err && err.message || err) });
  }
};
`;

function timedRun(result, started, fn) {
  result.durationMs = Math.round(Util.now() - started);
  result.severity = severityOf(result.status);
  return result;
}

// 用 fetch 探测资源，区分“加载成功 / 被策略拦截 / 普通网络失败”。
async function probeResource(label, url, { expectBlock, mode } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_FETCH);
  try {
    const res = await fetch(url, {
      mode: mode || 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    // no-cors 成功时为 opaque（status 0）；cors 成功时可读。
    if (expectBlock) {
      return { ok: false, expectedBlock: true, reason: '资源竟然加载成功：COEP 未生效' };
    }
    return { ok: true, status: res.status, type: res.type };
  } catch (err) {
    clearTimeout(timer);
    const msg = String(err.message || err);
    const blocked =
      /Failed to fetch|NetworkError|load failed|COEP|ERR_BLOCKED|Cross-Origin/i.test(msg);
    return {
      ok: false,
      blocked: blocked && !!expectBlock,
      networkError: !blocked,
      reason: msg,
    };
  }
}

async function createWorkerOnce(url, label) {
  return Util.withTimeout(
    new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(url);
      } catch (err) {
        reject(err);
        return;
      }
      const done = (fn) => (ev) => {
        cleanup();
        fn(ev);
      };
      const onError = (err) => done(reject)(err.message ? new Error(err.message) : err);
      const onMsg = (ev) => {
        if (ev.data && ev.data.type === 'ready') {
          done(resolve)({ worker, isolated: ev.data.isolated });
        }
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onError);
    }),
    TIMEOUT_WORKER,
    label,
  );
}

function askWorker(worker, data, timeoutMs = TIMEOUT_WORKER) {
  return Util.withTimeout(
    new Promise((resolve, reject) => {
      const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const onMsg = (ev) => {
        const d = ev.data;
        if (!d || d.id !== id) return;
        worker.removeEventListener('message', onMsg);
        d.type === 'error' ? reject(new Error(d.error)) : resolve(d);
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id, ...data });
    }),
    timeoutMs,
    'Worker 应答',
  );
}

export const Detector = {
  env: Util.env(),

  results: [],
  warnings: [],

  get env() {
    return Util.env();
  },

  async run(onProgress) {
    this.results = [];
    this.warnings = [];
    this._sameProbeDown = false;
    this._crossProbeDown = false;
    this._workerBatch = null;
    this._uaHints = await Util.uaHints();
    const checks = this.checks();
    for (const check of checks) {
      const started = Util.now();
      const result = makeResult(check.id, check.name, check.group);
      try {
        await check.run(result);
      } catch (err) {
        if (err && err.name === 'TimeoutError') {
          result.status = 'timeout';
          result.detail = Util.normalizeError(err).message;
        } else {
          result.status = 'error';
          result.detail = `检测异常：${Util.normalizeError(err).message}`;
        }
      }
      timedRun(result, started);
      // 探针批次依赖 health 结果：跨源不可达时把依赖项标记 skipped。
      if (check.id === 'server_reachable' && result.data?.crossOrigin === false) {
        this._crossProbeDown = true;
      }
      if (this._crossProbeDown && ['coep_enforcement', 'corp_cors'].includes(check.id)) {
        result.status = 'skipped';
        result.detail = '跨源探针端口不可达，已跳过。';
        result.severity = severityOf('skipped');
      }
      if (this._sameProbeDown && ['same_origin_no_corp', 'coep_report_only', 'permissions_policy_enforcement'].includes(check.id)) {
        result.status = 'skipped';
        result.detail = '测试服务器未运行（/health 不可达），已跳过。';
        result.severity = severityOf('skipped');
      }
      if (check.id === 'same_origin_no_corp' && result.status === 'error') {
        result.status = 'skipped';
        result.detail = '同源探针不可用，服务器未运行，后续探针结果无基线，故跳过。';
        result.severity = severityOf('skipped');
      }
      this.results.push(result);
      onProgress?.(result, [...this.results]);
    }
    this._workerChecks?.().cleanup?.();
    return this.summarize();
  },

  summarize() {
    const tier = Fallback.selectTier({ results: this.results });
    return {
      generatedAt: new Date().toISOString(),
      env: {
        ...this.env,
        userAgent: Util.env().userAgent,
        uaHints: this._uaHints || null,
      },
      tier,
      results: this.results,
      warnings: this.warnings,
      errorCount: this.results.filter((r) => r.status === 'error' || r.status === 'timeout').length,
      skipCount: this.results.filter((r) => r.status === 'skipped').length,
    };
  },
};

// ---- 检测项定义 -------------------------------------------------------------
Object.assign(Detector, {
  checks() {
    const envChecks = [
      {
        id: 'secure_context',
        name: '安全上下文（HTTPS / localhost）',
        group: '基础环境',
        run: (r) => {
          r.status = this.env.isSecure ? 'supported' : 'unsupported';
          r.detail = this.env.isSecure
            ? '当前为安全上下文，Worker / SAB 等特性才可能可用。'
            : `非安全上下文（${this.env.protocol}）：多数浏览器会直接禁用 SAB 与部分 Worker 特性。`;
          r.severity = this.env.isSecure ? 'ok' : 'critical';
        },
      },
      {
        id: 'cross_origin_isolated',
        name: 'crossOriginIsolated（COOP+COEP 已生效）',
        group: '隔离',
        run: (r) => {
          const iso = globalThis.crossOriginIsolated === true;
          r.status = iso ? 'supported' : 'unsupported';
          if (this.env.isolatedPath) {
            r.detail = iso
              ? '当前通过 /isolated 加载，COOP/COEP 响应头已生效。'
              : '页面声明走 /isolated 但 crossOriginIsolated 仍为 false，检查代理/缓存是否剥离散列头。';
          } else {
            r.detail = iso
              ? '顶层已处于跨源隔离状态。'
              : '顶层未隔离：需要同时发送 COOP: same-origin 与 COEP: require-corp。可访问 /isolated 验证。';
          }
        },
      },
      {
        id: 'sab',
        name: 'SharedArrayBuffer 可构造',
        group: '隔离',
        run: (r) => {
          const Ctor = globalThis.SharedArrayBuffer;
          if (typeof Ctor !== 'function') {
            r.status = 'unsupported';
            r.detail = 'window.SharedArrayBuffer 不存在：浏览器不支持或因未隔离/非安全上下文被隐藏。';
            return;
          }
          try {
            const buf = new Ctor(8);
            const view = new Int32Array(buf);
            Atomics.add(view, 0, 1);
            r.status = 'supported';
            r.detail = `可创建 SharedArrayBuffer（${buf.byteLength} 字节），Atomics 读写正常。`;
            r.data = { constructible: true, shared: true, growable: typeof Ctor.prototype.grow === 'function' };
          } catch (err) {
            r.status = 'error';
            r.detail = `构造失败：${Util.normalizeError(err).message}`;
          }
        },
      },
      {
        id: 'atomics',
        name: 'Atomics API',
        group: '隔离',
        run: (r) => {
          if (typeof globalThis.Atomics !== 'object' || !globalThis.Atomics) {
            r.status = 'unsupported';
            r.detail = 'Atomics 不可用。';
            return;
          }
          r.status = 'supported';
          r.detail = `Atomics.waitAsync：${
            typeof Atomics.waitAsync === 'function' ? '支持（可在主线程非阻塞等待）' : '不支持（只能在 Worker 内阻塞 wait）'
          }。`;
          r.data = { waitAsync: typeof Atomics.waitAsync === 'function' };
        },
      },
      {
        id: 'coop_inference',
        name: 'COOP（Cross-Origin-Opener-Policy）',
        group: '策略',
        run: (r) => {
          if (this.env.isFile) {
            r.status = 'skipped';
            r.detail = 'file:// 下无法发送 HTTP 响应头，跳过。';
            return;
          }
          const iso = globalThis.crossOriginIsolated === true;
          r.status = iso ? 'supported' : 'partial';
          r.detail = iso
            ? 'crossOriginIsolated=true，间接确认 COOP: same-origin 已生效（JS 无法直接读取响应头）。'
            : this.env.isolatedPath
              ? '走 /isolated 但未隔离：COOP 或 COEP 至少一个缺失/被代理剥离。'
              : '未在 /isolated 隔离页面，无法确认 COOP；请在隔离页面复测。响应头本身不能通过 JS 读取。';
          r.data = { header: 'Cross-Origin-Opener-Policy: same-origin' };
        },
      },
      {
        id: 'coep_inference',
        name: 'COEP（Cross-Origin-Embedder-Policy）',
        group: '策略',
        run: (r) => {
          if (this.env.isFile) {
            r.status = 'skipped';
            r.detail = 'file:// 下无法发送 HTTP 响应头，跳过。';
            return;
          }
          const iso = globalThis.crossOriginIsolated === true;
          r.status = iso ? 'supported' : 'partial';
          r.detail = iso
            ? 'COEP: require-corp 已生效（由 crossOriginIsolated 间接确认）。'
            : this.env.isolatedPath
              ? '隔离页面仍未隔离，COEP 可能缺失。'
              : '普通页面未声明 COEP；/probe/coep-report-only 可验证 Report-Only 通道。';
          r.data = { header: 'Cross-Origin-Embedder-Policy: require-corp' };
        },
      },
      {
        id: 'corp_header_support',
        name: 'CORP 响应头识别（浏览器能力）',
        group: '策略',
        run: (r) => {
          // CORP 是响应头、无 JS API；浏览器是否识别由 coep_enforcement / corp_cors 实测。
          r.status = 'info';
          r.detail =
            'CORP（Cross-Origin-Resource-Policy: same-origin|same-site|cross-origin）是响应指令，' +
            '无法通过 JS 直接读取；其支持情况由下方“COEP 强制拦截 / 跨源 CORP 放行”实测给出。';
          r.data = { values: ['same-origin', 'same-site', 'cross-origin'] };
        },
      },
      {
        id: 'feature_policy_api',
        name: 'Feature / Permissions Policy JS API',
        group: '策略',
        run: (r) => {
          const doc = globalThis.document;
          const fp = doc && (doc.featurePolicy || doc.permissionsPolicy);
          if (!fp) {
            r.status = 'unsupported';
            r.detail = 'document.featurePolicy / document.permissionsPolicy 均不可用。';
            return;
          }
          const isPerm = !!doc.permissionsPolicy;
          const allows = (f) => {
            try {
              return isPerm ? doc.permissionsPolicy.allowsFeature(f) : doc.featurePolicy.allowsFeature(f);
            } catch {
              return null;
            }
          };
          const sabAllowed = allows('shared-array-buffer');
          r.status = 'supported';
          r.detail = `${isPerm ? 'PermissionsPolicy' : 'FeaturePolicy'} API 可用；shared-array-buffer=${sabAllowed}。`;
          r.data = { api: isPerm ? 'permissionsPolicy' : 'featurePolicy', sabAllowed };
        },
      },
      {
        id: 'reporting_observer',
        name: 'ReportingObserver（违规上报 API）',
        group: '策略',
        run: (r) => {
          if (typeof globalThis.ReportingObserver !== 'function') {
            r.status = 'unsupported';
            r.detail = 'ReportingObserver 不可用（Firefox/Safari 目前不支持）；COEP 报告仍可走 Reporting-Endpoints 服务端收集。';
            return;
          }
          r.status = 'supported';
          r.detail = 'ReportingObserver 可实例化；加载 /probe/coep-report-only 后违规会进入报告中心（若浏览器上报）。';
        },
      },
    ];
    // 串联三批检测：基础/策略 → Worker/存储/传输 → 网络探针。
    const workers = this._workerChecks();
    const probes = this._probeChecks();
    const all = [...envChecks, ...workers, ...probes];
    return all;
  },
});

// ---- Worker / IndexedDB / 传输通道检测（第二批） -----------------------------
Object.assign(Detector, {
  _workerChecks() {
    if (this._workerBatch) return this._workerBatch;
    let workerUrl = null;
    let workerHandle = null;
    const ensure = async () => {
      if (!workerUrl) workerUrl = Util.blobWorkerUrl(WORKER_SOURCE);
      if (!workerHandle) workerHandle = await createWorkerOnce(workerUrl, '启动 Worker');
      return workerHandle;
    };

    const list = [
      {
        id: 'worker',
        name: 'Web Worker（经典 Blob Worker）',
        group: 'Worker',
        run: async (r) => {
          if (typeof globalThis.Worker !== 'function') {
            r.status = 'unsupported';
            r.detail = 'Worker 构造器不存在。';
            return;
          }
          const { isolated } = await ensure();
          r.status = 'supported';
          r.detail = `Worker 可创建并通信；Worker 内 crossOriginIsolated=${isolated}（必须与主线程一致，否则 COEP 未继承）。`;
          r.data = { isolatedInWorker: isolated };
        },
      },
      {
        id: 'worker_sab',
        name: 'SharedArrayBuffer 共享到 Worker',
        group: 'Worker',
        run: async (r) => {
          if (typeof globalThis.SharedArrayBuffer !== 'function') {
            r.status = 'skipped';
            r.detail = '主线程无 SharedArrayBuffer，跳过。';
            return;
          }
          if (globalThis.crossOriginIsolated !== true) {
            r.status = 'skipped';
            r.detail = '页面未跨源隔离：SAB 无法结构化克隆到 Worker（部分浏览器连 postMessage 都会抛 DataCloneError），跳过。';
            return;
          }
          await ensure();
          const buf = new SharedArrayBuffer(8);
          const d = await askWorker(workerHandle.worker, { cmd: 'sab', buffer: buf });
          const consistent = d.isolated === (globalThis.crossOriginIsolated === true);
          r.status = d.before === 0 && d.after === 7 ? 'supported' : 'partial';
          r.detail = `主线程写入前=${d.before}，Worker 内 Atomics.add(+7) 后=${d.after}；两侧隔离状态一致=${consistent}。`;
          r.data = d;
        },
      },
      {
        id: 'module_worker',
        name: 'Module Worker（type: module）',
        group: 'Worker',
        run: async (r) => {
          if (typeof globalThis.Worker !== 'function') {
            r.status = 'skipped';
            r.detail = '无 Worker，跳过。';
            return;
          }
          const url = Util.blobWorkerUrl('export const x = 1; self.postMessage({ type: "ready" });');
          try {
            const w = new Worker(url, { type: 'module' });
            await Util.withTimeout(
              new Promise((resolve, reject) => {
                w.addEventListener('message', () => {
                  w.terminate();
                  resolve();
                });
                w.addEventListener('error', (e) => reject(new Error(e.message || 'module worker error')));
              }),
              4000,
              'Module Worker 启动',
            );
            URL.revokeObjectURL(url);
            r.status = 'supported';
            r.detail = 'Module Worker 可创建（Firefox/Safari 历史上不支持，此处以实测为准）。';
          } catch (err) {
            URL.revokeObjectURL(url);
            r.status = 'unsupported';
            r.detail = `Module Worker 不可用：${Util.normalizeError(err).message}；降级为经典 Worker。`;
          }
        },
      },
      {
        id: 'idb',
        name: 'IndexedDB',
        group: '存储',
        run: async (r) => {
          if (typeof globalThis.indexedDB !== 'object' || !indexedDB) {
            r.status = 'unsupported';
            r.detail = 'indexedDB 不存在；报告历史将仅存内存。';
            return;
          }
          try {
            const open = indexedDB.open('coi-probe', 1);
            const db = await Util.withTimeout(idbRequest(open), 5000, '打开 IndexedDB');
            db.close();
            indexedDB.deleteDatabase('coi-probe');
            r.status = 'supported';
            r.detail = 'IndexedDB 可打开/建库/关闭；可用于报告历史与大数据降级缓存。';
          } catch (err) {
            r.status = 'error';
            r.detail = `IndexedDB 打开失败（可能处于隐私模式/被禁用）：${Util.normalizeError(err).message}`;
          }
        },
      },
      {
        id: 'idb_sab',
        name: 'SAB 结构化克隆进 IndexedDB',
        group: '存储',
        run: async (r) => {
          if (typeof globalThis.SharedArrayBuffer !== 'function' || globalThis.crossOriginIsolated !== true) {
            r.status = 'skipped';
            r.detail = !globalThis.crossOriginIsolated
              ? '非跨源隔离环境 SAB 不参与共享场景，跳过。'
              : '无 SharedArrayBuffer，跳过。';
            return;
          }
          try {
            const result = await idbRoundtripSAB();
            r.status = result ? 'supported' : 'partial';
            r.detail = result
              ? 'SAB 可写入并读回 IndexedDB（结构化克隆支持 SharedArrayBuffer）。'
              : 'SAB 写入/读回失败；持久化场景需先转普通 ArrayBuffer 或仅存快照。';
          } catch (err) {
            r.status = 'error';
            r.detail = `SAB 持久化检测异常：${Util.normalizeError(err).message}`;
          }
        },
      },
      {
        id: 'transferable',
        name: 'postMessage Transferable（零拷贝转移）',
        group: '传输',
        run: async (r) => {
          await ensure();
          const buf = new ArrayBuffer(1024);
          const d = await askWorker(workerHandle.worker, { cmd: 'transfer', buffer: buf }, [buf]);
          r.status = 'supported';
          r.detail = `ArrayBuffer（${d.byteLength} 字节）可零拷贝转移给 Worker；转移后主线程侧失效，属正常语义。`;
        },
      },
      {
        id: 'message_channel',
        name: 'MessageChannel / 结构化克隆',
        group: '传输',
        run: (r) => {
          if (typeof globalThis.MessageChannel !== 'function') {
            r.status = 'unsupported';
            r.detail = 'MessageChannel 不可用。';
            return;
          }
          r.status = 'supported';
          r.detail = 'MessageChannel 可用；普通 ArrayBuffer/对象可结构化克隆（拷贝）传递。';
        },
      },
      {
        id: 'broadcast_channel',
        name: 'BroadcastChannel（跨标签同步）',
        group: '传输',
        run: (r) => {
          if (typeof globalThis.BroadcastChannel !== 'function') {
            r.status = 'unsupported';
            r.detail = 'BroadcastChannel 不可用；历史报告跨标签同步将退化为 localStorage/storage 事件。';
            return;
          }
          r.status = 'supported';
          r.detail = 'BroadcastChannel 可用，保存报告后其他标签实时刷新。';
        },
      },
    ];

    list.cleanup = () => {
      try {
        workerHandle?.worker?.terminate();
      } catch {}
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
    this._workerBatch = list;
    return list;
  },
});

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDB request error'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onblocked = () => reject(new Error('IDB 被其他标签阻塞'));
  });
}

async function idbRoundtripSAB() {
  const open = indexedDB.open('coi-sab-probe', 1);
  const db = await Util.withTimeout(idbRequest(open), 5000, '打开 SAB 探测库');
  try {
    const sab = new SharedArrayBuffer(8);
    new Int8Array(sab)[0] = 42;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(sab, 'k');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const got = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get('k');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return got instanceof SharedArrayBuffer && new Int8Array(got)[0] === 42;
  } finally {
    db.close();
    indexedDB.deleteDatabase('coi-sab-probe');
  }
}

// ---- COEP / CORP 网络探针（第三批） -----------------------------------------
Object.assign(Detector, {
  _probeChecks() {
    const e = this.env;
    const cross = (path) => (e.crossOrigin ? `${e.crossOrigin}${path}` : '');
    const same = (path) => `${e.sameOrigin}${path}`;

    const skipFile = (r) => {
      if (e.isFile) {
        r.status = 'skipped';
        r.detail = 'file:// 无法使用测试服务器探针；请用 `node server/server.mjs` 后访问 http://localhost:8080/。';
        return true;
      }
      return false;
    };

    return [
      {
        id: 'server_reachable',
        name: '测试服务器 / 跨源端口可达',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          const results = await Promise.allSettled([
            fetch(same('/health'), { cache: 'no-store' }).then((x) => x.ok),
            fetch(cross('/health'), { mode: 'cors', cache: 'no-store' }).then((x) => x.ok),
          ]);
          const [a, b] = results.map((s) => (s.status === 'fulfilled' ? s.value : false));
          if (a && b) {
            r.status = 'supported';
            r.detail = `同源(:${new URL(e.sameOrigin).port}) 与跨源(:${new URL(e.crossOrigin).port}) 探针服务均可达。`;
          } else if (a) {
            r.status = 'partial';
            r.detail = '应用服务器可达，但跨源探针端口不可达（ORIGIN2_PORT 被占用？）；跨源 COEP/CORP 检测将跳过。';
            this.warnings.push('跨源探针端口不可达');
          } else {
            r.status = 'unsupported';
            r.detail = '未运行测试服务器；后续网络探针将跳过。启动：node server/server.mjs。';
            this._sameProbeDown = true;
            this._crossProbeDown = true;
          }
          r.data = { sameOrigin: a, crossOrigin: b };
        },
      },
      {
        id: 'same_origin_no_corp',
        name: '同源无 CORP 脚本（基线）',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          const p = await probeResource('同源基线', same('/probe/no-corp'));
          if (p.ok) {
            r.status = 'supported';
            r.detail = '同源脚本即使无 CORP 也能在 COEP 页面加载（同源豁免），作为拦截判定的基线。';
          } else {
            r.status = 'error';
            r.detail = `同源探针加载失败：${p.reason}（服务器未运行？）`;
          }
        },
      },
      {
        id: 'coep_enforcement',
        name: 'COEP 强制：跨源无 CORP 被拦截',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          if (globalThis.crossOriginIsolated !== true) {
            r.status = 'skipped';
            r.detail = '仅在跨源隔离页面（/isolated）检测强制行为；当前未隔离，加载跨源资源本就不会被 COEP 拦截。';
            return;
          }
          const p = await probeResource('跨源无CORP', cross('/probe/no-corp'), { expectBlock: true });
          if (p.blocked) {
            r.status = 'supported';
            r.detail = '跨源且无 CORP 的脚本被 COEP 阻止加载——COEP 强制生效（报错信息：' + p.reason + '）。';
          } else if (p.networkError) {
            r.status = 'skipped';
            r.detail = `探针网络失败，无法判定是否为策略拦截：${p.reason}`;
          } else if (!p.ok && p.expectedBlock) {
            r.status = 'partial';
            r.detail = p.reason;
          } else {
            r.status = 'unsupported';
            r.detail = '隔离页面下跨源无 CORP 资源竟可加载，COEP 未按预期强制。';
          }
        },
      },
      {
        id: 'corp_cors',
        name: 'CORP：跨源资源带 cross-origin 可放行',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          const p = await probeResource('跨源CORP放行', cross('/probe/corp-cors'), { mode: 'cors' });
          if (p.ok) {
            r.status = 'supported';
            r.detail = '跨源资源显式声明 Cross-Origin-Resource-Policy: cross-origin，隔离页面下可正常加载，证明 CORP 被识别并放行。';
          } else if (p.networkError) {
            r.status = 'skipped';
            r.detail = `探针网络失败：${p.reason}`;
          } else {
            r.status = 'unsupported';
            r.detail = `带 CORP: cross-origin 的跨源资源仍被拦截：${p.reason}`;
          }
        },
      },
      {
        id: 'coep_report_only',
        name: 'COEP-Report-Only 违规上报通道',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          if (typeof globalThis.ReportingObserver !== 'function') {
            r.status = 'partial';
            r.detail = '服务器探针支持 Report-Only + Reporting-Endpoints（服务端 /report-collector 接收），但本浏览器无 ReportingObserver JS API。';
            return;
          }
          // fetch 本身在非强制页面会成功；Report-Only 是否投递只能由 ReportingObserver 观察，
          // app.js 注册了全局 observer，这里确认探针可加载即可。
          const p = await probeResource('Report-Only', same('/probe/coep-report-only'));
          r.status = p.ok ? 'supported' : 'error';
          r.detail = p.ok
            ? 'Report-Only 探针可加载；违规（若有）经 Reporting-Endpoints 上报到服务端，并由 ReportingObserver 采集。'
            : `探针加载失败：${p.reason}`;
        },
      },
      {
        id: 'permissions_policy_enforcement',
        name: 'Permissions-Policy 对 SAB 的策略约束',
        group: '探针',
        run: async (r) => {
          if (skipFile(r)) return;
          // 顶层策略需要在响应头中声明才能改变 SAB 可用性；脚本资源上的策略头作用于其浏览上下文。
          // 这里检测 API 面并给出配置结论，不做会破坏当前页面的顶层注入。
          const api = this.results.find((x) => x.id === 'feature_policy_api');
          const doc = globalThis.document;
          const policy = doc && (doc.permissionsPolicy || doc.featurePolicy);
          if (!policy) {
            r.status = 'partial';
            r.detail = '无 PermissionsPolicy JS API；但可通过响应头 `Permissions-Policy: shared-array-buffer=(self)` 在服务端控制（/probe/permission-policy 为示例）。';
            return;
          }
          let allowed = null;
          try {
            allowed = doc.permissionsPolicy
              ? doc.permissionsPolicy.allowsFeature('shared-array-buffer')
              : doc.featurePolicy.allowsFeature('shared-array-buffer');
          } catch (err) {
            r.status = 'error';
            r.detail = '查询策略失败：' + Util.normalizeError(err).message;
            return;
          }
          r.status = 'supported';
          r.detail = `当前上下文 shared-array-buffer=${allowed}；可用 Permissions-Policy 精确授权/禁用 SAB。`;
          r.data = { allowed };
        },
      },
    ];
  },
});
