import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROBE_WORKER_SOURCE } from '../src/worker/probe-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'public', 'coi-probe-worker.js');
writeFileSync(target, PROBE_WORKER_SOURCE, 'utf8');
const written = readFileSync(target, 'utf8');
if (written !== PROBE_WORKER_SOURCE) {
  console.error('worker 构建产物与源字符串不一致');
  process.exit(1);
}
console.log(`worker 已生成: ${target} (${Buffer.byteLength(written)} bytes)`);
