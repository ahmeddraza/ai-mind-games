import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const token = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const call = async (fn, args = []) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value;
const expire = async roll => db.query("with t as (select clock_timestamp() t) update mind_games_private.attempts set started_at=t.t-interval '61 seconds',expires_at=t.t-interval '1 second' from t where roll_number=$1", [roll]);
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['001_secure_game.sql', '002_question_bank.sql', '004_randomized_question_order.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
});
after(() => db.close());
test('atomic reservation, canonical duplicates, idempotent start, credential isolation', async () => {
  const key = token();
  const first = await call('mm_start', ['24k-1001', key]);
  const retry = await call('mm_start', ['24K 1001', key]);
  assert.equal(first.roll_number, '24K1001'); assert.equal(first.deadline, retry.deadline);
  assert.deepEqual(first.question, retry.question);
  await assert.rejects(call('mm_start', ['24K1001', token()]), /ALREADY_USED/);
  await assert.rejects(call('mm_state', [token()]), /INVALID_SESSION/);
  assert(!JSON.stringify(first).includes('correct_option'));
  assert.equal(first.question.options.length, 4);
  const concurrent = await Promise.allSettled([call('mm_start', ['24K-CONCURRENT', token()]), call('mm_start', ['24k concurrent', token()])]);
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
});
test('15 distinct questions, shuffled options, server scoring, duplicates and finish idempotency', async () => {
  const key = token(); let state = await call('mm_start', ['24K-ALL', key]); const deadline = state.deadline, images = new Set();
  await assert.rejects(call('mm_finish', [key]), /TOO_EARLY/);
  for (let i = 1; i <= 15; i++) {
    assert.equal(state.question.position, i); assert.equal(state.question.id, state.question_order[i - 1]); assert.equal(state.question.options.length, i <= 10 ? 4 : 2);
    images.add(state.question.image);
    const snapshot = (await db.query('select snapshot from mind_games_private.attempts where token_hash=$1', [key])).rows[0].snapshot;
    const id = snapshot[i - 1].correct_option;
    const questionId = state.question.id;
    const result = await call('mm_answer', [key, questionId, id]);
    assert.equal(result.score, i * 100); assert.equal(result.deadline, deadline);
    const duplicate = await call('mm_answer', [key, questionId, id]); assert.equal(duplicate.score, i * 100);
    const other = state.question.options.find(option => option.id !== id).id;
    await assert.rejects(call('mm_answer', [key, questionId, other]), /ANSWER_CONFLICT/);
    state = result;
  }
  assert.equal(images.size, 15); assert.equal(state.finished, true);
  assert.deepEqual([state.result.score, state.result.correct_answers, state.result.incorrect_answers, state.result.unanswered_questions, state.result.accuracy], [1500, 15, 0, 0, 100]);
  const results = await Promise.all(Array.from({ length: 8 }, () => call('mm_finish', [key])));
  assert(results.every(r => r.result.id === state.result.id));
  assert.equal((await db.query("select count(*)::integer n from public.leaderboard where roll_number='24KALL'")).rows[0].n, 1);
  await assert.rejects(call('mm_start', ['24KALL', token()]), /ALREADY_USED/);
});
test('partial timeout, late answers, and background finalization', async () => {
  const key = token(); let state = await call('mm_start', ['24K-PARTIAL', key]);
  for (let i = 1; i <= 10; i++) {
    const snapshot = (await db.query('select snapshot from mind_games_private.attempts where token_hash=$1', [key])).rows[0].snapshot;
    const correctId = snapshot[i - 1].correct_option;
    const id = i <= 7 ? correctId : state.question.options.find(option => option.id !== correctId).id;
    state = await call('mm_answer', [key, state.question.id, id]);
  }
  await expire('24KPARTIAL');
  state = await call('mm_answer', [key, state.question.id, state.question.options[0].id]);
  assert.deepEqual([state.result.score, state.result.incorrect_answers, state.result.unanswered_questions, state.result.accuracy, state.result.time_remaining], [700, 3, 5, 70, 0]);
  const abandoned = token(); await call('mm_start', ['24K-CLOSED', abandoned]); await expire('24KCLOSED');
  await call('mm_leaderboard'); const final = await call('mm_state', [abandoned]);
  assert.equal(final.result.score, 0); assert.equal(final.result.unanswered_questions, 15);
});
test('database constraints, RLS, server-only RPC access, and ordering', async () => {
  await assert.rejects(db.query("insert into public.leaderboard(roll_number,score,correct_answers) values('24KINVALID',1501,15)"));
  await assert.rejects(db.query("insert into public.leaderboard(roll_number,score,correct_answers) values('24KMISMATCH',1400,15)"));
  await assert.rejects(db.query("insert into public.leaderboard(roll_number,score,correct_answers) values('24k-all',0,0)"));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.leaderboard'), /permission denied/);
    await assert.rejects(db.query('select * from mind_games_private.attempts'), /permission denied/);
    await assert.rejects(call('mm_start', ['24K-PUBLIC', token()]), /permission denied/);
    await assert.rejects(db.query("insert into public.leaderboard(roll_number,score,correct_answers) values('24KPUBLIC',0,0)"), /permission denied/);
    await assert.rejects(db.query('delete from public.leaderboard'), /permission denied/);
    await assert.rejects(db.query('update public.leaderboard set score=1500'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role'); assert(Array.isArray(await call('mm_leaderboard'))); await db.exec('reset role');
  const rows = await call('mm_leaderboard');
  assert(rows.every((row, i) => i === 0 || rows[i - 1].score >= row.score));
  const key = token(), state = await call('mm_start', ['24K-ORDER', key]);
  await assert.rejects(call('mm_answer', [key, state.question_order[1], state.question.options[0].id]), /OUT_OF_ORDER/);
});
test('existing bigint identity leaderboard is retained, normalized and usable', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec("create role anon;create role authenticated;create role service_role; create table public.leaderboard(id bigint generated always as identity primary key,roll_number text,score integer,correct_answers integer,created_at timestamptz default now()); insert into public.leaderboard(roll_number,score,correct_answers) values('24k-legacy',500,5)");
    await legacy.exec(await readFile('supabase/migrations/001_secure_game.sql','utf8'));
    await legacy.exec(await readFile('supabase/migrations/002_question_bank.sql','utf8'));
    await legacy.exec(await readFile('supabase/migrations/004_randomized_question_order.sql','utf8'));
    assert.equal((await legacy.query('select roll_number from public.leaderboard')).rows[0].roll_number,'24KLEGACY');
    const key = token(); await legacy.query('select public.mm_start($1,$2)',['24K-NEW',key]);
    await legacy.exec("with t as (select clock_timestamp() t) update mind_games_private.attempts set started_at=t.t-interval '61 seconds',expires_at=t.t-interval '1 second' from t");
    const result = (await legacy.query('select public.mm_finish($1) state',[key])).rows[0].state;
    assert.equal(result.result.id,'2'); assert.equal(result.result.score,0);
  } finally { await legacy.close(); }
});
