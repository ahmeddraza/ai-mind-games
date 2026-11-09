// Local integration-only Supabase REST substitute backed by actual PostgreSQL
// via PGlite. Production uses the official SDK against the configured Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export async function fixture({ databaseVersion = 6 } = {}) {
  const db = new PGlite();
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for (const file of ['001_secure_game.sql', '002_question_bank.sql', ...(databaseVersion >= 4 ? ['004_randomized_question_order.sql'] : []), ...(databaseVersion >= 5 ? ['005_randomization_readiness.sql'] : []), ...(databaseVersion >= 6 ? ['006_two_line_personality_clues.sql'] : [])]) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SECRET_KEY = 'integration-test-only-not-a-real-key';
  const nativeFetch = globalThis.fetch;
  const failures = new Set();
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url || String(input);
    if (!url.startsWith('https://supabase.test/rest/v1/rpc/')) return nativeFetch(input, options);
    const fn = url.split('/').pop();
    if (!['mm_start','mm_state','mm_start_randomized','mm_state_randomized','mm_answer','mm_finish','mm_leaderboard'].includes(fn)) return new Response('{}', { status:404 });
    const args = JSON.parse(options.body || '{}'), keys = Object.keys(args);
    try {
      const query = `select public.${fn}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as data`;
      const data = (await db.query(query, Object.values(args))).rows[0].data;
      if (failures.delete(fn)) return new Response(JSON.stringify({ message: 'Simulated lost response after commit' }), { status:503 });
      return new Response(JSON.stringify(data), { status:200, headers:{ 'Content-Type':'application/json' } });
    } catch (error) { return new Response(JSON.stringify({ message:error.message,code:error.code }), { status:400 }); }
  };
  const { createDevServer } = await import('../scripts/dev-server.mjs');
  const server = createDevServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, failNext: fn => failures.add(fn), close: async () => { await new Promise(resolve => server.close(resolve)); globalThis.fetch = nativeFetch; await db.close(); } };
}
