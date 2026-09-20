import { runCapabilityProbe } from '../src/index.js';
import { toMarkdown } from '../src/report/exporter.js';

const host = {
  runtime: 'node',
  global: globalThis,
  ua: process.env.UA || '',
  browser: { name: 'node', version: null },
  secureContext: false,
  url: '',
  platform: process.platform,
  language: 'en',
  online: true,
  timing: () => Number(process.hrtime.bigint() / 1000000n),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  documentPolicy: () => ({
    coop: process.env.COOP || null,
    coep: process.env.COEP || null,
    corp: process.env.CORP || null,
    coopReportOnly: null,
    coepReportOnly: null
  }),
  crossOriginIsolated: () => false
};

const report = await runCapabilityProbe({ host, persist: false, console: false });
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  process.stdout.write(toMarkdown(report));
}
