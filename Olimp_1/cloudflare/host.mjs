// Node 24 hosting. All requests and data stay on this host; Cloudflare is not used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import worker from './worker.mjs';
import { SqliteD1 } from './sqlite-d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:8013').origin;
const filename = path.resolve(process.env.OLIMP_DB || path.join(here, 'private', 'classroom.sqlite3'));
if (!fs.existsSync(filename)) throw Error('Classroom database missing. Restore the private migration before starting.');
const db = new SqliteD1(filename);
if (!db.connection.prepare('SELECT teacher_hash FROM app_meta WHERE id=1').get()?.teacher_hash) throw Error('Teacher key hash missing.');
const assets = fs.realpathSync(path.join(here, 'public'));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const env = { DB: db, ASSETS: { async fetch(request) {
  let filename;
  try { filename = fs.realpathSync(path.resolve(assets, '.' + decodeURIComponent(new URL(request.url).pathname))); }
  catch { return new Response('Not found', { status: 404 }); }
  if (!filename.startsWith(assets + path.sep) || !fs.statSync(filename).isFile()) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : fs.readFileSync(filename), { headers: {
    'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN'
  } });
} } };

const server = http.createServer(async (incoming, outgoing) => {
  try {
    let length = 0; const chunks = [];
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 200000) { outgoing.writeHead(413); outgoing.end('Request too large'); return; }
      chunks.push(chunk);
    }
    const request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers: incoming.headers,
      body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end('Ошибка сервера.'); }
});
server.requestTimeout = 20000;
server.headersTimeout = 15000;
server.listen(Number(process.env.PORT || 8013), process.env.IP || process.env.HOST || '127.0.0.1', () => console.log('Classroom HTTP service ready.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
