/* Evaluator organisation server for Node.js 18 or later. No packages needed.
 *
 *   NAME="My school" UPSTREAM_KEY=... TAVILY_KEY=... ACCESS_CODES="class9a-7x2k:Class 9A" \
 *   ALLOWED_ORIGINS=https://evaluator.example.org node server/node.mjs
 *
 * Listens on PORT (default 8787). Put it behind HTTPS (a reverse proxy such
 * as Caddy or nginx, or a platform that provides it). Daily counts are kept
 * in memory and start again when the server restarts.
 */
import http from 'node:http';
import { handle, loadConfig, configProblems, memoryStore } from './core.mjs';

const config = loadConfig(process.env);
const store = memoryStore();
const port = Number(process.env.PORT || 8787);
configProblems(config).forEach((p) => console.warn(`[evaluator-server] ${p}`));

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 7_000_000) { res.writeHead(413).end(); return; } }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
      method: req.method, headers: req.headers, signal: ctl.signal,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const ip = (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    const response = await handle(request, config, store, ip);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error('[evaluator-server]', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":{"message":"Server error."}}');
  }
}).listen(port, () => console.log(`[evaluator-server] "${config.name}" listening on port ${port}`));
