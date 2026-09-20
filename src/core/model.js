export const SUPPORT = Object.freeze({
  SUPPORTED: 'supported',
  PARTIAL: 'partial',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown',
  ERROR: 'error'
});

let findingSeq = 0;

export function createFinding(id, overrides = {}) {
  findingSeq += 1;
  return {
    id,
    seq: findingSeq,
    support: SUPPORT.UNKNOWN,
    details: {},
    warnings: [],
    error: null,
    durationMs: 0,
    ...overrides
  };
}

export function createReport() {
  return {
    schema: 'coi-capability-report/1.0',
    generatedAt: new Date().toISOString(),
    context: {
      userAgent: '',
      platform: '',
      language: '',
      url: '',
      secureContext: false,
      online: true,
      documentPolicy: {}
    },
    isolated: null,
    overall: SUPPORT.UNKNOWN,
    findings: [],
    fallback: { level: 'unknown', actions: [], strategies: {} },
    matrix: { browser: null, version: null, rows: [] },
    exceptions: []
  };
}

export function aggregateOverall(findings) {
  const values = findings.map((f) => f.support);
  if (values.length === 0) return SUPPORT.UNKNOWN;
  if (values.includes(SUPPORT.ERROR) && values.every((v) => v === SUPPORT.ERROR || v === SUPPORT.UNKNOWN)) {
    return SUPPORT.ERROR;
  }
  if (values.every((v) => v === SUPPORT.SUPPORTED)) return SUPPORT.SUPPORTED;
  if (values.some((v) => v === SUPPORT.UNSUPPORTED || v === SUPPORT.ERROR)) return SUPPORT.PARTIAL;
  if (values.some((v) => v === SUPPORT.PARTIAL || v === SUPPORT.UNKNOWN)) return SUPPORT.PARTIAL;
  return SUPPORT.SUPPORTED;
}
