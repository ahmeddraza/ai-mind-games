import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
// An explicit allowlist: backend source, SQL, audits, env files and answer keys
// are never copied into Vercel's public output. There is no frontend bundler.
const output = path.resolve('dist');
if (path.dirname(output) !== process.cwd() || path.basename(output) !== 'dist') throw new Error('Unsafe output directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'script.js', 'questions.js', 'leaderboard.js', 'audio.js']) {
  await copyFile(file, `dist/${file}`);
}
await cp('assets', 'dist/assets', { recursive: true });
