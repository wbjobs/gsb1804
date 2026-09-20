// 服务器核心：导出 createAppServer / createOrigin2Server，便于无监听测试。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
export const probeScript = `// probe\nself.onmessage=()=>{};`;

export function createAppServer({ origin2Port = 8081 } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store, max-age=0');
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (p === '/isolated') {
      res.setHeader('cross-origin-opener-policy', 'same-origin');
      res.setHeader('cross-origin-embedder-policy', 'require-corp');
      res.setHeader('cross-origin-resource-policy', 'same-origin');
      await serveFile(res, '/index.html');
      return;
    }

    switch (p) {
      case '/health':
        return json(res, { ok: true });
      case '/server-headers':
        return json(res, {
          isolated: {
            'cross-origin-opener-policy': 'same-origin',
            'cross-origin-embedder-policy': 'require-corp',
            'cross-origin-resource-policy': 'same-origin',
          },
          probes: [
            '/probe/no-corp',
            '/probe/corp-cors',
            '/probe/coep-report-only',
            '/probe/permission-policy',
          ],
          origin2Port,
        });
      case '/probe/no-corp':
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        return void res.end(probeScript);
      case '/probe/corp-cors':
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cross-origin-resource-policy': 'cross-origin',
        });
        return void res.end(probeScript);
      case '/probe/coep-report-only': {
        const endpoint = 'coep-report';
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'reporting-endpoints': `${endpoint}="/report-collector"`,
          'cross-origin-embedder-policy': `require-corp; report-to="${endpoint}"`,
        });
        return void res.end(probeScript);
      }
      case '/report-collector':
        res.writeHead(204, { type: 'application/reports+json' });
        return void res.end();
      case '/probe/permission-policy':
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'permissions-policy': 'shared-array-buffer=()',
          'cross-origin-resource-policy': 'cross-origin',
        });
        return void res.end(probeScript);
      default:
        return serveFile(res, p);
    }
  });
}

export function createOrigin2Server() {
  return http.createServer((req, res) => {
    res.setHeader('cache-control', 'no-store, max-age=0');
    const p = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (p === '/health') return json(res, { ok: true, origin: 2 });
    if (p === '/probe/no-corp') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return void res.end(probeScript);
    }
    if (p === '/probe/corp-cors') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cross-origin-resource-policy': 'cross-origin',
        'access-control-allow-origin': '*',
      });
      return void res.end(probeScript);
    }
    json(res, { error: 'not found' }, 404);
  });
}

async function serveFile(res, pathname) {
  const rel = normalize(pathname).replace(/^([/\\])+/, '');
  const file = join(root, rel === '' || rel === 'isolated' ? 'index.html' : rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cross-origin-resource-policy': 'same-origin',
    });
    res.end(body);
  } catch {
    res.writeHead(404, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'not found' }));
  }
}

function json(res, obj, status = 200, extra = {}) {
  res.writeHead(status, { ...JSON_HEADERS, 'access-control-allow-origin': '*', ...extra });
  res.end(JSON.stringify(obj));
}
