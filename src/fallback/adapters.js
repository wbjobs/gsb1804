import { ProbeError, ERROR_CODES } from '../core/errors.js';

export function createMutex(host) {
  const locks = host.global.navigator && host.global.navigator.locks;
  if (locks && typeof locks.request === 'function') {
    return {
      mode: 'web-locks',
      runExclusive(task, name = 'coi-default-lock') {
        return locks.request(name, task);
      }
    };
  }
  if (typeof host.global.SharedArrayBuffer === 'function' &&
      typeof host.global.Atomics === 'object' && host.global.Atomics &&
      host.crossOriginIsolated()) {
    const slots = new Map();
    return {
      mode: 'atomics-spin',
      runExclusive(task, name = 'coi-default-lock') {
        let slot = slots.get(name);
        if (!slot) {
          slot = new Int32Array(new host.global.SharedArrayBuffer(4));
          slots.set(name, slot);
        }
        return acquire(slot, host).then(() => Promise.resolve().then(task).finally(() => release(slot)));
      }
    };
  }
  const localLocks = new Map();
  return {
    mode: 'local-promise-chain',
    runExclusive(task, name = 'coi-default-lock') {
      const previous = localLocks.get(name) || Promise.resolve();
      let releaseLock;
      const gate = new Promise((resolve) => { releaseLock = resolve; });
      localLocks.set(name, previous.then(() => gate));
      return previous.then(() => Promise.resolve().then(task).finally(releaseLock));
    }
  };
}

function acquire(slot, host) {
  return new Promise((resolve) => {
    (function spin() {
      if (host.global.Atomics.compareExchange(slot, 0, 0, 1) === 0) {
        resolve();
        return;
      }
      setTimeout(spin, 4);
    })();
  });
}

function release(slot) {
  Atomics.store(slot, 0, 0);
}

export function resolveExecutionMode(findings) {
  const sab = findings.find((f) => f.id === 'sab');
  const workers = findings.find((f) => f.id === 'workers');
  const workerReady = !!(workers && workers.details && workers.details.dedicated && workers.details.dedicated.available);
  const workerSabReady = !!(workers && workers.details && workers.details.workerSab && workers.details.workerSab.available);
  const sabReady = !!(sab && sab.support === 'supported');
  const atomicsReady = !!(sab && sab.details && sab.details.atomicsAvailable);
  if (sabReady && workerSabReady) return { mode: 'shared-memory-worker', sabReady, workerReady, atomicsReady };
  if (sabReady) return { mode: 'shared-memory-main', sabReady, workerReady, atomicsReady };
  if (workerReady) return { mode: 'postmessage-worker', sabReady, workerReady, atomicsReady };
  if (atomicsReady) return { mode: 'atomics-main', sabReady: false, workerReady, atomicsReady };
  return { mode: 'main-thread', sabReady, workerReady, atomicsReady };
}

export function createTaskExecutor(host, findings, implementations = {}) {
  const resolved = resolveExecutionMode(findings);
  return {
    ...resolved,
    async run(payload = {}) {
      if (resolved.mode === 'shared-memory-worker' && typeof implementations.sharedWorker === 'function') {
        return implementations.sharedWorker(payload, resolved);
      }
      if (resolved.mode === 'postmessage-worker' && typeof implementations.messageWorker === 'function') {
        return implementations.messageWorker(payload, resolved);
      }
      if (typeof implementations.main === 'function') {
        return implementations.main(payload, resolved);
      }
      throw new ProbeError(ERROR_CODES.UNEXPECTED,
        `执行模式 ${resolved.mode} 未提供对应实现，无法完成降级执行`);
    }
  };
}
