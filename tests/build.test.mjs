import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import { cookieHeader } from '../server/http.js';
test('public build contains only allowlisted assets, no keys or authoritative answer data', async () => {
  execFileSync(process.execPath, ['scripts/prepare-static.mjs']);
  assert.deepEqual((await readdir('dist')).sort(), ['assets','audio.js','index.html','leaderboard.js','questions.js','script.js','style.css'].sort());
  for (const file of ['index.html','leaderboard.js','questions.js','script.js','audio.js','style.css']) {
    const source = await readFile(`dist/${file}`, 'utf8');
    for (const secret of ['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','sb_secret_','correct_option','"answer":']) assert(!source.includes(secret), `${secret} found in ${file}`);
  }
  for (const file of ['server/question-bank.json','supabase/migrations/002_question_bank.sql','.env.local','QUESTION_AUDIT.md']) await assert.rejects(access(`dist/${file}`));
});
test('production cookies require HTTPS security flags; legacy key alternative works', async () => {
  assert.match(cookieHeader('a'.repeat(64), { headers:{'x-forwarded-proto':'https'} }), /; Secure/);
  assert.match(cookieHeader('a'.repeat(64), { headers:{} }), /HttpOnly; SameSite=Strict/);
  const previous = { ...process.env };
  try {
    process.env.SUPABASE_URL = 'https://supabase.test';
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-legacy-key';
    const { getDatabase } = await import('../server/db.js?legacy-key-test');
    assert.equal(getDatabase().supabaseKey, 'test-only-legacy-key');
  } finally {
    for (const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
