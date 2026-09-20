export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_API: 'UNSUPPORTED_API',
  WORKER_SPAWN_FAILED: 'WORKER_SPAWN_FAILED',
  WORKER_TIMEOUT: 'WORKER_TIMEOUT',
  WORKER_MESSAGE_INVALID: 'WORKER_MESSAGE_INVALID',
  PROBE_BLOCKED: 'PROBE_BLOCKED',
  PROBE_HTTP_ERROR: 'PROBE_HTTP_ERROR',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  STORAGE_QUOTA: 'STORAGE_QUOTA',
  EXPORT_FAILED: 'EXPORT_FAILED',
  UNEXPECTED: 'UNEXPECTED'
});

export class ProbeError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function toProbeError(error, fallbackCode = ERROR_CODES.UNEXPECTED) {
  if (error instanceof ProbeError) return error;
  const code = (error && error.name === 'SecurityError')
    ? ERROR_CODES.PROBE_BLOCKED
    : fallbackCode;
  return new ProbeError(code, (error && error.message) || String(error), error);
}

export function describeError(error) {
  if (!error) return null;
  if (error instanceof ProbeError) {
    return { code: error.code, message: error.message };
  }
  return { code: ERROR_CODES.UNEXPECTED, message: (error.message || String(error)) };
}
