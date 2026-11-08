import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const migration = () => readFile('supabase/migrations/004_randomized_question_order.sql','utf8');
const key = () => randomBytes(32).toString('hex');
async function database(randomized = true) {
  const db = new PGlite();
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for (const name of ['001_secure_game.sql','002_question_bank.sql']) await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
  if (randomized) await db.exec(await migration());
  return db;
}
async function call(db, fn, params = []) {
  return (await db.query(`select public.${fn}(${params.map((_, i) => `$${i+1}`).join(',')}) value`,params)).rows[0].value;
}
const snapshot = async (db, token) => (await db.query('select snapshot from mind_games_private.attempts where token_hash=$1',[token])).rows[0].snapshot;
const sorted = values => [...values].sort((a,b) => a-b);

test('sessions assign 10+5 unique stable IDs, varied orders, and immutable secure option mappings', async () => {
  const db = await database();
  try {
    const bank = JSON.parse(await readFile('server/question-bank.json','utf8')).flatMap(round=>round.questions);
    const orders = new Set(), optionOrders = new Set();
    for (let i=0;i<8;i++) {
      const token=key(), roll=`24K-RANDOM${i}`;
      const state=await call(db,'mm_start',[roll,token]), saved=await snapshot(db,token);
      assert.equal(state.question_order.length,15);
      assert.deepEqual(sorted(state.question_order.slice(0,10)),Array.from({length:10},(_,i)=>i+1));
      assert.deepEqual(sorted(state.question_order.slice(10)),[11,12,13,14,15]);
      assert.equal(new Set(saved.map(q=>q.image)).size,15);
      assert.equal(state.question.id,state.question_order[0]);
      orders.add(JSON.stringify(state.question_order));
      for (let j=0;j<saved.length;j++) {
        const question=saved[j], original=bank[question.id-1];
        assert.equal(question.position,j+1);assert.equal(question.round,j<10?1:2);
        assert.equal(question.round_question,j<10?j+1:j-9);
        assert.equal(question.options.length,j<10?4:2);
        assert.equal(question.options.find(o=>o.id===question.correct_option).text,original.options[original.answer]);
        assert.deepEqual(question.options.map(o=>o.text).sort(),[...original.options].sort());
        if(question.id===1)optionOrders.add(question.options.map(o=>o.text).join('|'));
      }
      const resume=await call(db,'mm_state',[token]),retry=await call(db,'mm_start',[roll,token]);
      assert.deepEqual(resume.question_order,state.question_order);assert.deepEqual(retry.question_order,state.question_order);
      assert.deepEqual(resume.question,state.question);assert.equal(retry.deadline,state.deadline);
      assert.deepEqual(await snapshot(db,token),saved);
      const serialized=JSON.stringify(state);
      for(const privateField of ['correct_option','token_hash','"answer"','"index"'])assert(!serialized.includes(privateField));
    }
    // Orders are not forced unique in production: equal permutations are valid.
    // A small sample checks that different orders/options can actually be produced.
    assert(orders.size>1);assert(optionOrders.size>1);
  } finally { await db.close(); }
});

test('server enforces assigned stable IDs, including rejecting a positional ID',async()=>{
  const db=await database();
  try {
    // Choose a session whose first stable ID differs from its position (1).
    let token,state,saved;
    for(let i=0;i<20;i++) {
      token=key();state=await call(db,'mm_start',[`24K-SEQUENCE${i}`,token]);saved=await snapshot(db,token);
      if(state.question.id!==1)break;
    }
    assert.notEqual(state.question.id,1);
    await assert.rejects(call(db,'mm_answer',[token,1,state.question.options[0].id]),/OUT_OF_ORDER/);
    await assert.rejects(call(db,'mm_answer',[token,saved[1].id,saved[1].options[0].id]),/OUT_OF_ORDER/);
    await assert.rejects(call(db,'mm_answer',[token,saved[0].id,saved[1].options[0].id]),/INVALID_REQUEST/);
    const deadline=state.deadline;
    for(let position=0;position<15;position++) {
      const question=saved[position];
      const results=await Promise.all([call(db,'mm_answer',[token,question.id,question.correct_option]),call(db,'mm_answer',[token,question.id,question.correct_option])]);
      assert(results.every(r=>r.score===(position+1)*100));
      state=results[0];assert.equal(state.deadline,deadline);assert.deepEqual(state.question_order,saved.map(q=>q.id));
    }
    assert.equal(state.result.score,1500);assert.equal(state.result.correct_answers,15);
    assert.deepEqual(sorted((await db.query('select question_id from mind_games_private.answers where roll_number=$1',[state.roll_number])).rows.map(r=>r.question_id)),Array.from({length:15},(_,i)=>i+1));
    await assert.rejects(call(db,'mm_start',[state.roll_number,key()]),/ALREADY_USED/);
  } finally { await db.close(); }
});

test('migration preserves active/completed legacy snapshots, answers, deadlines and leaderboard records',async()=>{
  const db=await database(false);
  try {
    const active=key(),completed=key();
    let state=await call(db,'mm_start',['24K-LEGACYACTIVE',active]);
    const saved=await snapshot(db,active);
    await call(db,'mm_answer',[active,1,saved[0].correct_option]);
    await call(db,'mm_start',['24K-LEGACYDONE',completed]);
    await db.exec("with t as(select clock_timestamp() t) update mind_games_private.attempts set started_at=t.t-interval '61 seconds',expires_at=t.t-interval '1 second' from t where roll_number='24KLEGACYDONE'");
    await call(db,'mm_finish',[completed]);
    const before={ attempts:(await db.query('select * from mind_games_private.attempts order by roll_number')).rows,
      answers:(await db.query('select * from mind_games_private.answers')).rows,
      leaderboard:(await db.query('select * from public.leaderboard order by id')).rows,
      questions:(await db.query('select * from mind_games_private.questions order by id')).rows };
    await db.exec(await migration());
    assert.deepEqual((await db.query('select * from mind_games_private.attempts order by roll_number')).rows,before.attempts);
    assert.deepEqual((await db.query('select * from mind_games_private.answers')).rows,before.answers);
    assert.deepEqual((await db.query('select * from public.leaderboard order by id')).rows,before.leaderboard);
    assert.deepEqual((await db.query('select * from mind_games_private.questions order by id')).rows,before.questions);
    state=await call(db,'mm_state',[active]);
    assert.deepEqual(state.question_order,Array.from({length:15},(_,i)=>i+1));assert.equal(state.question.id,2);assert.equal(state.question.position,2);
    assert.equal(state.deadline,Math.floor(new Date(before.attempts.find(a=>a.token_hash===active).expires_at).getTime()));
    for(let id=2;id<=15;id++)state=await call(db,'mm_answer',[active,id,saved[id-1].correct_option]);
    assert.equal(state.result.score,1500);
    const oldResult=await call(db,'mm_state',[completed]);assert.equal(oldResult.result.id,before.leaderboard[0].id);
    assert.deepEqual(await snapshot(db,active),saved);
  }finally{await db.close();}
});

test('secure shuffle handles boundaries, preserves inputs and stays private',async()=>{
  const db=await database();
  try {
    for(const input of [[],[1],[1,2,3,4,5]]) {
      const result=(await db.query('select mind_games_private.secure_shuffle($1::jsonb) result',[JSON.stringify(input)])).rows[0].result;
      assert.deepEqual(sorted(result),input);
    }
    for(const bound of [1,2,3,5,10,15,32767]) {
      const values=(await db.query('select mind_games_private.secure_random_below($1) value from generate_series(1,25)',[bound])).rows;
      assert(values.every(({value})=>Number.isInteger(value)&&value>=0&&value<bound));
    }
    await assert.rejects(db.query('select mind_games_private.secure_random_below(0)'),/INVALID_REQUEST/);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select mind_games_private.secure_shuffle('[1,2]')"),/permission denied/);
      await assert.rejects(call(db,'mm_start',['24K-PUBLIC',key()]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});
