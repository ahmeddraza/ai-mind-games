import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fixture } from './fixture.mjs';
let app;
before(async () => { app = await fixture(); });
after(() => app.close());
function client() {
  let cookie = '';
  return { async request(route, body) {
    const response = await fetch(app.base + '/api/' + route, { method:body === undefined ? 'GET':'POST',
      headers:{ 'Content-Type':'application/json', Cookie:cookie },body:body === undefined ? undefined:JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie') };
  } };
}
const nonce = () => randomBytes(32).toString('hex');
test('API reserves once, normalizes rolls, hides answers, and cookie resumes without resetting', async () => {
  const a = client(), b = client();
  const result = await a.request('start-game', { roll_number:'24k-9000',nonce:nonce() });
  assert.equal(result.status,200); assert.equal(result.body.roll_number,'24K9000'); assert.match(result.cookie,/HttpOnly/); assert.match(result.cookie,/SameSite=Strict/);
  assert(!JSON.stringify(result.body).includes('correct_option'));
  const resumed = await a.request('start-game',{ resume:true }); assert.equal(resumed.body.deadline,result.body.deadline);
  const duplicate = await b.request('start-game',{ roll_number:'24K 9000',nonce:nonce() });assert.equal(duplicate.status,409);assert.equal(duplicate.body.error,'ALREADY_USED');
  assert.equal((await b.request('finish-game',{})).status,401);
});
test('lost start response can retry same nonce; lost answer response retries exactly once', async () => {
  const a = client(), n = nonce(); app.failNext('mm_start');
  const first = await a.request('start-game',{ roll_number:'24K-LOST',nonce:n });
  const start = await a.request('start-game',{ roll_number:'24K-LOST',nonce:n });
  assert.equal(start.status,200); assert([200,503].includes(first.status));
  assert.equal((await app.db.query("select count(*)::int n from mind_games_private.attempts where roll_number='24KLOST'")).rows[0].n,1);
  const correct = (await app.db.query("select snapshot->0->>'correct_option' id from mind_games_private.attempts where roll_number='24KLOST'")).rows[0].id;
  app.failNext('mm_answer'); await a.request('submit-answer',{ question_id:1,option_id:correct });
  const retry = await a.request('submit-answer',{ question_id:1,option_id:correct });
  assert.equal(retry.body.score,100); assert.equal(retry.body.answered,1);assert.equal(retry.body.question.id,2);
});
test('fabricated scores, wrong methods, cross-origin requests and private files are rejected', async () => {
  const a = client(); await a.request('start-game',{ roll_number:'24K-FORGE',nonce:nonce() });
  assert.equal((await a.request('finish-game',{ score:1500 })).status,400);
  assert.equal((await a.request('submit-answer',{ question_id:1,option_id:'fake',score:1500 })).status,400);
  assert.equal((await fetch(app.base+'/api/start-game')).status,405);
  assert.equal((await fetch(app.base+'/api/start-game',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,403);
  for (const file of ['/server/question-bank.json','/supabase/migrations/002_question_bank.sql','/.env.local','/package.json','/QUESTION_AUDIT.md','/assets/..%2fserver/question-bank.json']) assert.equal((await fetch(app.base+file)).status,404);
  const manifest = await (await fetch(app.base+'/questions.js')).text(); assert(!manifest.includes('"answer"')); assert(!manifest.includes('correct_option'));
});
test('public leaderboard shares verified results across independent clients', async () => {
  const a = client(), b = client(); await a.request('start-game',{roll_number:'24K-GLOBAL',nonce:nonce()});
  await app.db.query("with t as (select clock_timestamp() t) update mind_games_private.attempts set started_at=t.t-interval '61 seconds',expires_at=t.t-interval '1 second' from t where roll_number='24KGLOBAL'");
  const final = await a.request('finish-game',{}), again = await a.request('finish-game',{});
  assert.equal(final.body.result.score,0);assert.equal(final.body.result.id,again.body.result.id);
  assert.deepEqual((await a.request('leaderboard')).body,(await b.request('leaderboard')).body);
});
