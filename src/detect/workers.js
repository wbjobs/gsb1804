import { SUPPORT } from '../core/model.js';
import { createWorkerProbe } from './worker-support.js';
import { assertSabInWorker } from './sab.js';

export function createWorkersDetector(options = {}) {
  return async function detectWorkers(host) {
    const win = host.global;
    const warnings = [];
    const sub = {
      dedicated: { available: typeof win.Worker === 'function' },
      module: { available: false },
      shared: { available: typeof win.SharedWorker === 'function' },
      workerSab: { available: false },
      workerIndexedDB: { available: false }
    };
    if (host.runtime !== 'browser' || typeof win.Worker !== 'function') {
      return {
        support: typeof win.Worker === 'function' ? SUPPORT.SUPPORTED : SUPPORT.UNSUPPORTED,
        details: sub,
        warnings: typeof win.Worker === 'function' ? [] : ['当前环境不支持 Web Worker，所有并行计算需回退到主线程']
      };
    }
    const probe = createWorkerProbe(host, options);
    let classicResult;
    let moduleResult;
    let sharedResult;
    try {
      classicResult = await probe.classic();
      sub.dedicated = { available: true, env: classicResult.env };
      sub.workerSab = summarizeSab(classicResult);
      const idbResult = classicResult.indexedDB;
      sub.workerIndexedDB = idbResult ? { available: idbResult.ok === true, detail: idbResult } : { available: false };
    } catch (error) {
      sub.dedicated = { available: false, error: error.code || 'UNEXPECTED', message: error.message };
      warnings.push(`经典 Worker 探针失败: ${error.message}`);
    }
    try {
      moduleResult = await probe.module();
      sub.module = { available: true, env: moduleResult.env };
    } catch (error) {
      sub.module = { available: false, error: error.code || 'UNEXPECTED', message: error.message };
      warnings.push('Module Worker 不可用，将使用经典 Worker 回退');
    }
    try {
      sharedResult = await probe.shared();
      sub.shared = { available: true, env: sharedResult.env };
      try {
        assertSabInWorker(sharedResult);
        sub.shared.sabVerified = true;
      } catch (error) {
        sub.shared.sabVerified = false;
      }
    } catch (error) {
      sub.shared = { available: false, error: error.code || 'UNEXPECTED', message: error.message };
    }
    let support = SUPPORT.SUPPORTED;
    if (!sub.dedicated.available) support = SUPPORT.UNSUPPORTED;
    else if (!sub.module.available || !sub.shared.available) support = SUPPORT.PARTIAL;
    return { support, details: sub, warnings };
  };
}

function summarizeSab(result) {
  const sab = result && result.sab;
  if (!sab) return { available: false };
  return {
    available: sab.ok === true,
    detail: sab
  };
}
