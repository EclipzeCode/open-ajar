import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** Serves files from publicDir only. Rejects traversal and dotfiles. */
export function createStatic({ publicDir, production }) {
  const base = path.resolve(publicDir);
  return async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.includes('\0') || rel.split('/').some((seg) => seg.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
    if (rel === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' }); return res.end(); } // the icon is inlined in index.html
    if (rel === '/' ) rel = '/index.html';
    const file = path.resolve(base, '.' + rel);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(404); return res.end('Not found'); }

    let stat;
    try { stat = await fs.promises.stat(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    if (!stat.isFile()) { res.writeHead(404); return res.end('Not found'); }

    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': production && !isHtml ? 'public, max-age=300' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  };
}
