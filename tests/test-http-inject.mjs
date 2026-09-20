import assert from 'node:assert/strict';
import { createAppServer, createOrigin2Server } from '../server/http-app.mjs';

function inject(server, { method = 'GET', url = '/', host = 'localhost:8080' }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      getHeader(k) { return this.headers[k.toLowerCase()]; },
      writeHead(status, headers = {}) {
        this.statusCode = status;
        for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
      },
      write(c) { this.chunks.push(Buffer.from(c)); },
      end(c) { if (c) this.chunks.push(Buffer.from(c)); resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(this.chunks).toString() }); },
    };
    server.emit('request', { method, url, headers: { host } }, res);
  });
}

const app = createAppServer({ origin2Port: 8081 });
const o2 = createOrigin2Server();

// 隔离页面响应头
const isolated = await inject(app, { url: '/isolated' });
assert.equal(isolated.status, 200);
assert.equal(isolated.headers['cross-origin-opener-policy'], 'same-origin');
assert.equal(isolated.headers['cross-origin-embedder-policy'], 'require-corp');
assert.equal(isolated.headers['cross-origin-resource-policy'], 'same-origin');
assert.match(isolated.body, /<!DOCTYPE html>/);

// 静态资源 MIME + CORP
const js = await inject(app, { url: '/js/app.js' });
assert.equal(js.status, 200);
assert.match(js.headers['content-type'], /text\/javascript/);
assert.equal(js.headers['cross-origin-resource-policy'], 'same-origin');
const css = await inject(app, { url: '/css/app.css' });
assert.match(css.headers['content-type'], /text\/css/);
const root = await inject(app, { url: '/' });
assert.equal(root.status, 200);
assert.match(root.body, /<!DOCTYPE html>/);

// 健康检查与声明头
const health = await inject(app, { url: '/health' });
assert.equal(health.status, 200);
assert.deepEqual(JSON.parse(health.body), { ok: true });
const sh = await inject(app, { url: '/server-headers' });
assert.equal(JSON.parse(sh.body).origin2Port, 8081);

// 同源无 CORP 探针（不应有 corp 头）
const noCorp = await inject(app, { url: '/probe/no-corp' });
assert.equal(noCorp.status, 200);
assert.equal(noCorp.headers['cross-origin-resource-policy'], undefined);

// CORP cross-origin 放行探针
const corpCors = await inject(app, { url: '/probe/corp-cors' });
assert.equal(corpCors.headers['cross-origin-resource-policy'], 'cross-origin');

// Report-Only 探针
const ro = await inject(app, { url: '/probe/coep-report-only' });
assert.match(ro.headers['cross-origin-embedder-policy'], /report-to=/);
assert.match(ro.headers['reporting-endpoints'], /\/report-collector/);

// Permissions-Policy 探针
const pp = await inject(app, { url: '/probe/permission-policy' });
assert.equal(pp.headers['permissions-policy'], 'shared-array-buffer=()');
assert.equal(pp.headers['cross-origin-resource-policy'], 'cross-origin');

// 报告收集端点
const collector = await inject(app, { url: '/report-collector' });
assert.equal(collector.status, 204);

// 跨源服务器：无 CORP / 有 CORP
const xNoCorp = await inject(o2, { url: '/probe/no-corp', host: 'localhost:8081' });
assert.equal(xNoCorp.status, 200);
assert.equal(xNoCorp.headers['cross-origin-resource-policy'], undefined);
const xCorp = await inject(o2, { url: '/probe/corp-cors', host: 'localhost:8081' });
assert.equal(xCorp.headers['cross-origin-resource-policy'], 'cross-origin');
assert.equal(xCorp.headers['access-control-allow-origin'], '*');

// 路径穿越防护
const evil = await inject(app, { url: '/../../etc/passwd' });
assert.ok([403, 404].includes(evil.status), 'path traversal blocked');

console.log('HTTP INJECTION TESTS PASSED (16 routes/headers)');
process.exit(0);
