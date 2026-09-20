import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const srcDir = join(root, 'src');
const isolated = process.env.ISOLATED === '1';
const port = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/report' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const report = JSON.parse(body);
          console.log(`[report] ${new Date().toISOString()} overall=${report.overall} isolated=${report.isolated}`);
          res.writeHead(204, isolationHeaders());
          res.end();
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json', ...isolationHeaders() });
      res.end(JSON.stringify({ ok: true, isolated, time: new Date().toISOString() }));
      return;
    }
    const served = await serveStatic(url.pathname, res);
    if (!served) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error && error.stack || error));
  }
}

async function serveStatic(pathname, res) {
  const clean = decodeURIComponent(pathname).split('?')[0];
  const relative = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const safe = relative && !relative.includes('\0') && !relative.split('/').includes('..');
  const isolatedPage = clean === '/isolated.html';
  const candidates = safe ? [
    clean.startsWith('/src/') ? join(srcDir, relative.slice('src/'.length)) : null,
    join(publicDir, relative)
  ].filter(Boolean) : [];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) continue;
      const data = await readFile(candidate);
      const headers = {
        'content-type': MIME[extname(candidate)] || 'application/octet-stream',
        'cache-control': 'no-store'
      };
      if (isolated || isolatedPage) Object.assign(headers, isolationHeaders());
      let payload = data;
      if ((isolated || isolatedPage) && extname(candidate) === '.html') {
        payload = Buffer.from(injectHeaderScript(data.toString('utf8')), 'utf8');
      }
      res.writeHead(200, headers);
      res.end(payload);
      return true;
    } catch {
      /* 继续尝试下一个候选路径 */
    }
  }
  return false;
}

function injectHeaderScript(html) {
  const injected = `<script>window.__COI_HEADERS__=${JSON.stringify(isolationHeaders())};</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${injected}`);
  return injected + html;
}

function isolationHeaders() {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) {
  const server = createServer(handler);
  server.listen(port, () => {
    console.log(`COI 探针服务已启动${isolated ? '（隔离模式 COOP+COEP）' : '（普通模式）'}`);
    console.log(`  普通页: http://localhost:${port}/`);
    console.log(`  隔离页: http://localhost:${port}/isolated.html`);
  });
}
