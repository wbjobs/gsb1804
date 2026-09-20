import { SUPPORT } from '../core/model.js';
import { ProbeError, ERROR_CODES } from '../core/errors.js';

export function createSabDetector() {
  return async function detectSab(host) {
    const warnings = [];
    const checks = runMainThreadChecks(host);
    const isolated = host.crossOriginIsolated();
    let support = SUPPORT.UNSUPPORTED;
    if (checks.constructorAvailable && checks.mainThreadWorks && isolated) {
      support = SUPPORT.SUPPORTED;
    } else if (checks.constructorAvailable && checks.mainThreadWorks && !isolated) {
      support = SUPPORT.UNSUPPORTED;
      warnings.push('当前浏览器支持 SharedArrayBuffer，但文档未跨源隔离，访问已被禁用');
    } else if (checks.constructorAvailable && !checks.mainThreadWorks) {
      support = SUPPORT.ERROR;
      warnings.push(`SharedArrayBuffer 存在但自检失败: ${checks.failure || '未知原因'}`);
    } else if (checks.constructorExists === false) {
      support = SUPPORT.UNSUPPORTED;
      warnings.push('当前浏览器不存在 SharedArrayBuffer 构造函数');
    } else {
      support = SUPPORT.UNKNOWN;
    }
    if (checks.constructorAvailable && !checks.atomics) {
      support = SUPPORT.PARTIAL;
      warnings.push('缺少 Atomics，无法进行共享内存同步');
    }
    return {
      support,
      details: {
        crossOriginIsolated: isolated,
        constructorExists: checks.constructorExists,
        constructorUsable: checks.constructorAvailable,
        atomicsAvailable: checks.atomics,
        waitAsyncAvailable: checks.waitAsync,
        mainThreadSelfTest: checks.mainThreadWorks,
        failure: checks.failure || null
      },
      warnings
    };
  };
}

export function runMainThreadChecks(host) {
  const target = host.global;
  const constructorExists = typeof target.SharedArrayBuffer === 'function';
  let constructorAvailable = false;
  let mainThreadWorks = false;
  let failure = null;
  if (constructorExists) {
    try {
      const buffer = new target.SharedArrayBuffer(16);
      constructorAvailable = buffer.byteLength === 16;
      const view = new Int32Array(buffer);
      if (typeof target.Atomics === 'object' && target.Atomics) {
        target.Atomics.store(view, 0, 1);
        mainThreadWorks = target.Atomics.add(view, 0, 41) === 1;
      }
    } catch (error) {
      failure = error.message || String(error);
      if (error instanceof TypeError || /denied|disabled|blocked/i.test(failure)) {
        constructorAvailable = false;
      }
    }
  }
  const atomics = typeof target.Atomics === 'object' && target.Atomics !== null;
  const waitAsync = atomics && typeof target.Atomics.waitAsync === 'function';
  return { constructorExists, constructorAvailable, atomics, waitAsync, mainThreadWorks, failure };
}

export function assertSabInWorker(workerResult) {
  if (!workerResult || workerResult.available === false) {
    throw new ProbeError(ERROR_CODES.WORKER_SPAWN_FAILED, 'Worker 不可用，无法验证 Worker 内 SAB');
  }
  const sab = workerResult.sab;
  if (!sab || sab.ok !== true) {
    throw new ProbeError(ERROR_CODES.PROBE_BLOCKED,
      `Worker 内 SharedArrayBuffer 不可用: ${(sab && sab.reason) || '未知原因'}`);
  }
  return sab;
}
