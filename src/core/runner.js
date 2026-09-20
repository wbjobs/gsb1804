import { createFinding } from './model.js';
import { describeError, toProbeError } from './errors.js';

export async function runDetector(id, host, detect, exceptions) {
  const start = host.timing();
  try {
    const overrides = await detect(host) || {};
    return createFinding(id, {
      durationMs: Math.max(0, Math.round(host.timing() - start)),
      ...overrides
    });
  } catch (error) {
    const probeError = toProbeError(error);
    exceptions.push(describeError(probeError));
    return createFinding(id, {
      support: 'error',
      error: describeError(probeError),
      durationMs: Math.max(0, Math.round(host.timing() - start))
    });
  }
}

export async function withTimeout(promiseFactory, ms, host, timeoutCode) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = host.global.setTimeout
      ? host.global.setTimeout(() => reject(toProbeError(new Error(`操作在 ${ms}ms 后超时`), timeoutCode)), ms)
      : setTimeout(() => reject(toProbeError(new Error(`操作在 ${ms}ms 后超时`), timeoutCode)), ms);
  });
  try {
    return await Promise.race([promiseFactory(), timeout]);
  } finally {
    if (host.global.clearTimeout) host.global.clearTimeout(timer);
    else clearTimeout(timer);
  }
}
