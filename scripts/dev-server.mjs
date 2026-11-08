import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import start from '../api/start-game.js';
import answer from '../api/submit-answer.js';
import finish from '../api/finish-game.js';
import leaderboard from '../api/leaderboard.js';
const handlers = { '/api/start-game': start, '/api/submit-answer': answer, '/api/finish-game': finish, '/api/leaderboard': leaderboard };
const publicFiles = new Set(['index.html', 'style.css', 'script.js', 'leaderboard.js', 'questions.js', 'audio.js']);
export function createDevServer() {
  return http.createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => res.end(JSON.stringify(data));
    try {
      const url = new URL(req.url, 'http://localhost');
      if (handlers[url.pathname]) {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.statusCode = 413; res.end(); return; } }
        req.body = body;
        return await handlers[url.pathname](req, res);
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      if (!publicFiles.has(relative) && !relative.startsWith('assets/')) { res.statusCode = 404; res.end('Not found'); return; }
      const root = path.resolve('.'), target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) { res.statusCode = 404; res.end(); return; }
      if (relative.startsWith('assets/') && !target.startsWith(path.join(root, 'assets') + path.sep)) { res.statusCode = 404; res.end(); return; }
      const ext = path.extname(target);
      res.setHeader('Content-Type', { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' }[ext] || 'application/octet-stream');
      res.end(await readFile(target));
    } catch (_) { res.statusCode = 404; res.end('Not found'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDevServer();
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`MIND vs MACHINE: http://localhost:${server.address().port}`));
}
