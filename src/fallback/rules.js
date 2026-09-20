import { SUPPORT } from '../core/model.js';
import { resolveExecutionMode } from './adapters.js';

export function planFallback(findings) {
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  const actions = [];
  const strategies = {};

  const isolated = !!(byId.sab && byId.sab.details && byId.sab.details.crossOriginIsolated);
  const execution = resolveExecutionMode(findings);
  strategies.computation = {
    mode: execution.mode,
    sabReady: execution.sabReady,
    workerReady: execution.workerReady,
    atomicsReady: execution.atomicsReady,
    description: COMPUTE_DESCRIPTIONS[execution.mode]
  };
  if (execution.mode !== 'shared-memory-worker') {
    actions.push({
      level: execution.mode === 'main-thread' ? 'critical' : 'warning',
      area: 'computation',
      title: COMPUTE_DESCRIPTIONS[execution.mode],
      detail: computeDetail(execution)
    });
  }

  const coop = byId.coop;
  const coep = byId.coep;
  strategies.isolation = {
    coop: coop ? coop.details.header : null,
    coep: coep ? coep.details.header : null,
    isolated,
    recipe: isolated ? null : {
      headers: [
        'Cross-Origin-Opener-Policy: same-origin',
        'Cross-Origin-Embedder-Policy: require-corp'
      ],
      resources: '为无法加 CORP 的第三方资源改用 CORS 加载，或考虑按浏览器分流到 credentialless / require-corp',
      reportOnlyFirst: '上线前先用 *-Report-Only + Reporting-Endpoints 收集阻断报告'
    }
  };
  if (!isolated) {
    actions.push({
      level: 'critical',
      area: 'isolation',
      title: '文档未跨源隔离，SharedArrayBuffer 不可用',
      detail: '补齐 COOP same-origin 与 COEP require-corp，或提供主线程/消息传递实现'
    });
  }
  if (coep && coep.details.header === 'credentialless') {
    strategies.isolation.credentiallessFallback = 'Firefox/Safari 使用 require-corp，Chrome/Edge 可用 credentialless 减少资源改造成本';
  }

  const workers = byId.workers;
  if (workers) {
    strategies.workers = summarizeWorkerStrategy(workers.details);
    if (!workers.details.dedicated.available) {
      actions.push({ level: 'critical', area: 'worker', title: 'Web Worker 不可用', detail: '并行任务全部回退到主线程分片执行（setTimeout/requestIdleCallback 切片）' });
    }
    if (workers.details.dedicated.available && !workers.details.module.available) {
      actions.push({ level: 'info', area: 'worker', title: 'Module Worker 不可用', detail: '使用经典 Worker + importScripts，模块代码预打包为 IIFE' });
    }
    if (!workers.details.shared.available) {
      actions.push({ level: 'info', area: 'worker', title: 'SharedWorker 不可用', detail: '共享状态改为 BroadcastChannel/localStorage 事件或 IndexedDB 轮询协调' });
    }
  }

  const idb = byId.idb;
  strategies.storage = idb && idb.support === SUPPORT.SUPPORTED
    ? { primary: 'indexeddb', fallback: ['memory-lru', 'json-download'] }
    : { primary: 'memory-lru', fallback: ['json-download'] };
  if (!idb || idb.support !== SUPPORT.SUPPORTED) {
    actions.push({
      level: idb && idb.support === SUPPORT.ERROR ? 'warning' : 'critical',
      area: 'storage',
      title: 'IndexedDB 不可用',
      detail: '报告与缓存使用内存 LRU，并在页面卸载前引导用户导出 JSON 文件'
    });
  }

  const corp = byId.corp;
  if (corp && corp.support !== SUPPORT.SUPPORTED) {
    actions.push({
      level: 'warning',
      area: 'resources',
      title: 'CORP 覆盖不完整',
      detail: '隔离页面对无 CORP 的跨源资源改用 crossorigin 属性 + CORS，或资源侧补 Cross-Origin-Resource-Policy: cross-origin'
    });
  }

  const fp = byId.featurePolicy;
  if (fp && fp.support !== SUPPORT.SUPPORTED) {
    actions.push({
      level: 'info',
      area: 'policy',
      title: 'Feature/Permissions Policy 支持不完整',
      detail: '同时写入 Feature-Policy 旧头与 Permissions-Policy 新头；iframe 上保留 allow 属性'
    });
  }

  const errors = findings.filter((f) => f.support === SUPPORT.ERROR);
  errors.forEach((f) => {
    actions.push({
      level: 'warning',
      area: f.id,
      title: `${f.id} 检测发生异常`,
      detail: f.error ? f.error.message : '未知异常，已跳过该项能力假设'
    });
  });

  const level = actions.some((a) => a.level === 'critical')
    ? 'degraded-critical'
    : actions.some((a) => a.level === 'warning')
      ? 'degraded-partial'
      : isolated ? 'full' : 'degraded-partial';

  return { level, actions, strategies };
}

const COMPUTE_DESCRIPTIONS = {
  'shared-memory-worker': '完整能力：Worker + SharedArrayBuffer + Atomics，可使用共享内存并行',
  'shared-memory-main': '部分降级：仅主线程可用 SharedArrayBuffer，避免 Worker 间零拷贝假设',
  'postmessage-worker': '降级：Worker 可用，改用结构化克隆/postMessage 传递数据',
  'atomics-main': '降级：Atomics 可用但 SAB 不可用，按主线程串行编排',
  'main-thread': '最终降级：全部在主线程分片执行'
};

function computeDetail(execution) {
  if (execution.mode === 'postmessage-worker') return '数据以 Transferable（ArrayBuffer 转移）或结构化克隆传递，避免拷贝大对象';
  if (execution.mode === 'main-thread') return '任务切片为 < 4ms 的小块，通过 scheduler.yield/setTimeout 让出主线程';
  if (execution.mode === 'shared-memory-main') return '数据结构不假设跨 Worker 共享视图，统一在主线程访问 SAB';
  return '避免依赖 SAB 同步原语，使用 Promise 队列串行化关键区';
}

function summarizeWorkerStrategy(details) {
  return {
    classic: details.dedicated.available,
    module: details.module.available,
    shared: details.shared.available,
    workerSab: !!(details.workerSab && details.workerSab.available),
    workerIndexedDB: !!(details.workerIndexedDB && details.workerIndexedDB.available)
  };
}
