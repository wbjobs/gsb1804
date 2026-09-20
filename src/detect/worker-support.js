import { ProbeError, ERROR_CODES } from '../core/errors.js';
import { PROBE_WORKER_SOURCE } from '../worker/probe-source.js';

let commandSeq = 0;

function nextId() {
  commandSeq += 1;
  return `cmd-${Date.now().toString(36)}-${commandSeq}`;
}

export function makeProbeUrl(host, options) {
  if (options && options.workerUrl) return options.workerUrl;
  const win = host.global;
  const blob = new win.Blob([PROBE_WORKER_SOURCE], { type: 'application/javascript' });
  return win.URL.createObjectURL(blob);
}

export function createWorkerProbe(host, options = {}) {
  return {
    classic: () => probeDedicated(host, { ...options, type: 'classic' }),
    module: () => probeDedicated(host, { ...options, type: 'module' }),
    shared: () => probeShared(host, options)
  };
}

async function probeDedicated(host, options) {
  const win = host.global;
  if (typeof win.Worker !== 'function') {
    return { available: false, reason: 'NO_WORKER_CONSTRUCTOR' };
  }
  const url = makeProbeUrl(host, options);
  let worker;
  try {
    worker = options.type === 'module'
      ? new win.Worker(url, { type: 'module' })
      : new win.Worker(url);
  } catch (error) {
    throw new ProbeError(ERROR_CODES.WORKER_SPAWN_FAILED,
      `${options.type} Worker 创建失败: ${error.message || error}`, error);
  }
  const timeoutMs = options.timeoutMs || 4000;
  try {
    const env = await postCommand(worker, host, { id: nextId(), cmd: 'env' }, timeoutMs);
    const sabPayload = await postCommand(worker, host, { id: nextId(), cmd: 'sab' }, timeoutMs);
    const idb = await postCommand(worker, host, { id: nextId(), cmd: 'idb' }, timeoutMs);
    return {
      available: true,
      type: options.type,
      env,
      sab: sabPayload.sab,
      indexedDB: idb
    };
  } finally {
    try { worker.terminate(); } catch { /* 忽略终止异常 */ }
    if (!options.workerUrl) {
      try { win.URL.revokeObjectURL(url); } catch { /* 忽略回收异常 */ }
    }
  }
}

async function probeShared(host, options) {
  const win = host.global;
  if (typeof win.SharedWorker !== 'function') {
    return { available: false, reason: 'NO_SHARED_WORKER_CONSTRUCTOR' };
  }
  const url = makeProbeUrl(host, options);
  let worker;
  try {
    worker = new win.SharedWorker(url);
  } catch (error) {
    throw new ProbeError(ERROR_CODES.WORKER_SPAWN_FAILED,
      `SharedWorker 创建失败: ${error.message || error}`, error);
  }
  const port = worker.port;
  const timeoutMs = options.timeoutMs || 4000;
  try {
    const result = await postPortCommand(port, host, { id: nextId(), cmd: 'sab' }, timeoutMs);
    return { available: true, env: result.env, sab: result.sab };
  } finally {
    try { port.close(); } catch { /* 忽略关闭异常 */ }
    if (!options.workerUrl) {
      try { win.URL.revokeObjectURL(url); } catch { /* 忽略回收异常 */ }
    }
  }
}

function postCommand(worker, host, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = host.global.setTimeout(() => {
      cleanup();
      reject(new ProbeError(ERROR_CODES.WORKER_TIMEOUT, `Worker 响应超时 (${message.cmd})`));
    }, timeoutMs);
    function cleanup() { host.global.clearTimeout(timer); worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); }
    function onMessage(event) {
      const data = event.data;
      if (!data || data.id !== message.id) return;
      cleanup();
      if (data.ok) resolve(data.result);
      else reject(new ProbeError(ERROR_CODES.WORKER_MESSAGE_INVALID, `Worker 执行失败: ${data.error}`));
    }
    function onError(event) {
      cleanup();
      reject(new ProbeError(ERROR_CODES.WORKER_SPAWN_FAILED,
        (event && event.message) || 'Worker 运行时错误'));
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(message);
  });
}

function postPortCommand(port, host, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = host.global.setTimeout(() => {
      cleanup();
      reject(new ProbeError(ERROR_CODES.WORKER_TIMEOUT, `SharedWorker 响应超时 (${message.cmd})`));
    }, timeoutMs);
    function cleanup() { host.global.clearTimeout(timer); port.removeEventListener('message', onMessage); port.removeEventListener('messageerror', onMessageError); }
    function onMessage(event) {
      const data = event.data;
      if (!data || data.id !== message.id) return;
      cleanup();
      if (data.ok) resolve(data.result);
      else reject(new ProbeError(ERROR_CODES.WORKER_MESSAGE_INVALID, `SharedWorker 执行失败: ${data.error}`));
    }
    function onMessageError() {
      cleanup();
      reject(new ProbeError(ERROR_CODES.WORKER_MESSAGE_INVALID, 'SharedWorker 反序列化消息失败'));
    }
    port.addEventListener('message', onMessage);
    port.addEventListener('messageerror', onMessageError);
    port.start();
    port.postMessage(message);
  });
}
