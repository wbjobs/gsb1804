import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../scripts/server.js';
import { Readable } from 'node:stream';

function call(method, path, body) {
  return new Promise((resolve) => {
    const headers = {};
    const req = new Readable({ read() {} });
    req.headers = { host: 'localhost' };
    req.method = method;
    req.url = path;
    const res = {
      statusCode: 200,
      headers,
      chunks: [],
      writeHead(status, values) {
        this.statusCode = status;
        if (values) Object.keys(values).forEach((k) => { headers[k.toLowerCase()] = values[k]; });
      },
      end(chunk) {
        if (chunk) this.chunks.push(Buffer.from(chunk));
        resolve({ status: this.statusCode, headers, body: Buffer.concat(this.chunks).toString() });
      }
    };
    handler(req, res);
    if (body) req.push(body);
    req.push(null);
  });
}

test('普通首页不携带隔离头', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(res.headers['cross-origin-opener-policy'], undefined);
  assert.match(res.body, /能力检测台/);
});

test('isolated.html 携带 COOP/COEP/CORP 三件套', async () => {
  const res = await call('GET', '/isolated.html');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
});

test('隔离页注入 window.__COI_HEADERS__ 供特性检测读取', async () => {
  const res = await call('GET', '/isolated.html');
  assert.match(res.body, /window\.__COI_HEADERS__/);
  assert.match(res.body, /Cross-Origin-Embedder-Policy/);
});

test('Worker 与 /src 模块文件可访问', async () => {
  const worker = await call('GET', '/coi-probe-worker.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers['content-type'], /javascript/);
  assert.match(worker.body, /sabRoundtrip/);
  const app = await call('GET', '/src/ui/app.js');
  assert.equal(app.status, 200);
  assert.match(app.body, /runCapabilityProbe/);
});

test('健康检查与报告上报', async () => {
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  const report = await call('POST', '/api/report', JSON.stringify({ overall: 'partial', isolated: false }));
  assert.equal(report.status, 204);
  const bad = await call('POST', '/api/report', 'not-json');
  assert.equal(bad.status, 400);
});

test('未知路径 404 且路径穿越无效', async () => {
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('GET', '/../../etc/passwd')).status, 404);
});
