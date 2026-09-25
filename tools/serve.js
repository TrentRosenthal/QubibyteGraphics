#!/usr/bin/env node
/**
 * Static file server for the editor, the embed demo, and end-to-end
 * tests. Serves the repository root with correct MIME types (module scripts
 * need them) and CORS headers so the sandboxed iframe
 * fallback, whose origin is opaque, can still load engine modules and fonts.
 *
 * Usage: node tools/serve.js [--port 8080] [--root .]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.jhf': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Start a static server.
 * @param {{port?: number, root?: string, host?: string}} [opts] port 0 picks a free port
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function startServer(opts = {}) {
  const root = resolve(opts.root ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const host = opts.host ?? '127.0.0.1';
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(join(root, path));
    if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(302, { location: url.pathname.replace(/\/?$/, '/') }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 8080, host, () => {
      const port = server.address().port;
      ok({ url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`, port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const { url } = await startServer({ port: Number(get('--port', process.env.PORT ?? 8080)), root: get('--root', undefined) });
  console.log(`Serving at ${url}`);
}
