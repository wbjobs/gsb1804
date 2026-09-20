import { createHost } from './core/env.js';
import { createReport, aggregateOverall } from './core/model.js';
import { runDetector } from './core/runner.js';
import { createCoopDetector } from './detect/coop.js';
import { createCoepDetector } from './detect/coep.js';
import { createCorpDetector } from './detect/corp.js';
import { createSabDetector } from './detect/sab.js';
import { createFeaturePolicyDetector } from './detect/feature-policy.js';
import { createWorkersDetector } from './detect/workers.js';
import { createIdbDetector } from './detect/idb.js';
import { buildCompatibilityMatrix } from './matrix/engine.js';
import { planFallback } from './fallback/rules.js';
import { createReportStore } from './report/storage.js';
import { logToConsole } from './report/exporter.js';

export async function runCapabilityProbe(options = {}) {
  const host = options.host || createHost(options.window || (typeof window !== 'undefined' ? window : undefined));
  const exceptions = [];
  const detectors = [
    ['coop', options.detectors && options.detectors.coop ? options.detectors.coop : createCoopDetector()],
    ['coep', options.detectors && options.detectors.coep ? options.detectors.coep : createCoepDetector()],
    ['corp', options.detectors && options.detectors.corp ? options.detectors.corp : createCorpDetector(options.corp || {})],
    ['sab', options.detectors && options.detectors.sab ? options.detectors.sab : createSabDetector()],
    ['featurePolicy', options.detectors && options.detectors.featurePolicy ? options.detectors.featurePolicy : createFeaturePolicyDetector()],
    ['workers', options.detectors && options.detectors.workers ? options.detectors.workers : createWorkersDetector(options.workers || {})],
    ['idb', options.detectors && options.detectors.idb ? options.detectors.idb : createIdbDetector(options.idb || {})]
  ];
  const findings = [];
  for (const [id, detector] of detectors) {
    findings.push(await runDetector(id, host, detector, exceptions));
  }

  const report = createReport();
  report.generatedAt = new Date().toISOString();
  report.context = buildContext(host);
  report.findings = findings;
  report.isolated = findings.some((f) => f.id === 'sab' && f.details && f.details.crossOriginIsolated === true);
  report.overall = aggregateOverall(findings);
  report.fallback = planFallback(findings);
  report.matrix = buildCompatibilityMatrix(host.browser, findings);
  report.exceptions = exceptions;

  if (options.persist !== false && host.runtime === 'browser') {
    try {
      const store = createReportStore(host, options.storage || {});
      await store.save(report);
      report.storage = { backend: store.backend };
    } catch (error) {
      report.storage = { backend: 'memory', error: { code: error.code, message: error.message } };
      report.exceptions.push({ code: error.code || 'STORAGE_UNAVAILABLE', message: error.message });
    }
  }
  if (options.console !== false && host.runtime === 'browser') {
    logToConsole(report, options.logger || host.global.console);
  }
  return report;
}

function buildContext(host) {
  const policy = host.documentPolicy();
  return {
    userAgent: host.ua,
    platform: host.platform,
    language: host.language,
    url: host.url,
    secureContext: host.secureContext,
    online: host.online,
    documentPolicy: policy
  };
}
