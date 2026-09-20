import { MATRIX, BROWSERS, FEATURES } from './data.js';

const FINDING_TO_MATRIX = {
  coop: 'coop',
  coep: 'coep',
  corp: 'corp',
  sab: 'sab',
  featurePolicy: 'feature_policy',
  workers: null,
  idb: 'idb'
};

export function buildCompatibilityMatrix(browser, findings) {
  const rows = MATRIX.rows.map((row) => {
    const prediction = browser && browser.version !== null && row[browser.name]
      ? predict(row[browser.name], browser.version)
      : 'unknown';
    const actual = findActual(row.feature, findings);
    return {
      feature: row.feature,
      label: featureLabel(row.feature),
      expected: prediction,
      actual,
      browsers: BROWSERS.reduce((acc, b) => {
        acc[b.key] = formatCell(row[b.key]);
        return acc;
      }, {})
    };
  });
  const mismatches = rows
    .filter((row) => row.actual && row.expected !== 'unknown' && contradiction(row.expected, row.actual))
    .map((row) => ({ feature: row.feature, expected: row.expected, actual: row.actual }));
  return {
    browser: browser ? browser.name : null,
    version: browser ? browser.version : null,
    browserLabel: browserLabel(browser),
    rows,
    mismatches,
    references: MATRIX.references,
    note: MATRIX.note,
    lastReviewed: MATRIX.lastReviewed,
    columns: BROWSERS.map((b) => b.key),
    columnLabels: BROWSERS.reduce((acc, b) => { acc[b.key] = b.label; return acc; }, {})
  };
}

function predict(cell, version) {
  if (!cell || cell.min === null || version === null) return 'unknown';
  return version >= cell.min ? 'supported' : 'unsupported';
}

function formatCell(cell) {
  if (!cell) return { supported: 'unknown', label: '?', min: null };
  if (cell.min === null) return { supported: false, label: cell.note || '不支持', min: null, approx: !!cell.approx };
  return { supported: true, label: `${cell.min}+`, min: cell.min, note: cell.note || '', approx: !!cell.approx };
}

function findActual(feature, findings) {
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  if (feature === 'coep_credentialless') {
    const coep = byId.coep;
    if (!coep) return null;
    return coep.details.header === 'credentialless' ? normalize(coep.support) : null;
  }
  if (feature === 'crossOriginIsolated') {
    const sab = byId.sab;
    return sab ? (sab.details.crossOriginIsolated ? 'supported' : 'unsupported') : null;
  }
  if (feature === 'atomics_wait_async') {
    const sab = byId.sab;
    return sab ? (sab.details.waitAsyncAvailable ? 'supported' : 'unsupported') : null;
  }
  if (feature === 'permissions_policy') {
    const fp = byId.featurePolicy;
    return fp ? (fp.details.permissionsPolicy ? 'supported' : 'unsupported') : null;
  }
  if (feature === 'feature_policy') {
    const fp = byId.featurePolicy;
    return fp ? (fp.details.legacyFeaturePolicy ? 'supported' : 'unsupported') : null;
  }
  if (feature === 'module_worker' || feature === 'shared_worker') {
    const workers = byId.workers;
    if (!workers || !workers.details) return null;
    if (feature === 'module_worker') return workers.details.module && workers.details.module.available ? 'supported' : 'unsupported';
    return workers.details.shared && workers.details.shared.available ? 'supported' : 'unsupported';
  }
  if (feature === 'worker') {
    const workers = byId.workers;
    return workers ? (workers.details.dedicated.available ? 'supported' : 'unsupported') : null;
  }
  if (feature === 'idb_worker') {
    const workers = byId.workers;
    const available = workers && workers.details.workerIndexedDB && workers.details.workerIndexedDB.available;
    if (available === undefined) return null;
    return available ? 'supported' : 'unsupported';
  }
  const findingId = Object.keys(FINDING_TO_MATRIX).find((id) => FINDING_TO_MATRIX[id] === feature);
  const finding = findingId ? byId[findingId] : null;
  return finding ? normalize(finding.support) : null;
}

function normalize(support) {
  if (support === 'supported') return 'supported';
  if (support === 'unsupported') return 'unsupported';
  if (support === 'partial') return 'partial';
  if (support === 'error') return 'error';
  return 'unknown';
}

function contradiction(expected, actual) {
  if (actual === 'partial' || actual === 'error' || actual === 'unknown') return false;
  if (expected === 'supported' && actual === 'unsupported') return true;
  if (expected === 'unsupported' && actual === 'supported') return true;
  return false;
}

function featureLabel(key) {
  const found = FEATURES.find((f) => f.key === key);
  return found ? found.label : key;
}

function browserLabel(browser) {
  if (!browser) return null;
  const found = BROWSERS.find((b) => b.key === browser.name);
  return found ? found.label : browser.name;
}
