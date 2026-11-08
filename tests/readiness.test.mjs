import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { fixture } from './fixture.mjs';
let app;
const repair = () => readFile('supabase/migrations/005_randomization_readiness.sql','utf8');
const hash = token => createHash('sha256').update(token).digest('hex');
const nonce = () => randomBytes(32).toString('hex');
async function post(body, cookie='') {
  const response=await fetch(app.base+'/api/start-game',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
before(async()=>{ app=await fixture({databaseVersion:3}); });
after(()=>app.close());
test('outdated database fails clearly before consuming a new roll instead of serving fixed order',async()=>{
  const response=await post({roll_number:'24K-MISSING',nonce:nonce()});
  assert.equal(response.status,503);assert.equal(response.data.error,'RANDOMIZATION_NOT_READY');assert.match(response.data.message,/005_randomization_readiness/);
  assert.equal((await app.db.query('select count(*)::int n from mind_games_private.attempts')).rows[0].n,0);
});
test('self-contained repair restores shuffling without 004 and labels existing sessions as resumed',async()=>{
  const token='a'.repeat(64);
  const original=(await app.db.query('select public.mm_start($1,$2) state',['24K-LEGACY',hash(token)])).rows[0].state;
  const before=(await app.db.query('select * from mind_games_private.attempts')).rows;
  const oldOrders=[];
  for(let i=0;i<2;i++) {
    await app.db.query('select public.mm_start($1,$2)',[`24K-OLD${i}`,hash(`old-${i}`)]);
    oldOrders.push((await app.db.query('select snapshot from mind_games_private.attempts where roll_number=$1',[`24KOLD${i}`])).rows[0].snapshot.map(q=>q.id));
  }
  assert.deepEqual(oldOrders[0],oldOrders[1]); // Reproduces pre-update fixed order.
  await app.db.exec(await repair());
  assert.deepEqual((await app.db.query("select * from mind_games_private.attempts where roll_number='24KLEGACY'")).rows,before);
  const resumed=await post({resume:true},`mm_session=${token}`);
  assert.equal(resumed.status,200);assert.equal(resumed.data.resumed,true);assert.equal(resumed.data.order_type,'legacy');assert.equal(resumed.data.randomization_version,2);
  assert.equal(resumed.data.deadline,original.deadline);assert.deepEqual(resumed.data.question_order,Array.from({length:15},(_,i)=>i+1));
  const orders=[];
  for(let i=0;i<4;i++) {
    const started=await post({roll_number:`24K-NEW${i}`,nonce:nonce()});
    assert.equal(started.status,200);assert.equal(started.data.resumed,false);assert.equal(started.data.order_type,'randomized');
    assert.equal(new Set(started.data.question_order).size,15);
    assert(started.data.question_order.slice(0,10).every(id=>id<=10));assert(started.data.question_order.slice(10).every(id=>id>10));
    orders.push(JSON.stringify(started.data.question_order));
  }
  assert(new Set(orders).size>1);
});
test('rerunning an obsolete factory cannot silently reintroduce fixed-order reservations',async()=>{
  await app.db.exec(await readFile('supabase/migrations/001_secure_game.sql','utf8'));
  const count=(await app.db.query('select count(*)::int n from mind_games_private.attempts')).rows[0].n;
  const result=await post({roll_number:'24K-REGRESSION',nonce:nonce()});
  assert.equal(result.status,503);assert.equal(result.data.error,'RANDOMIZATION_NOT_READY');
  assert.equal((await app.db.query('select count(*)::int n from mind_games_private.attempts')).rows[0].n,count);
  await app.db.exec(await repair());
});
test('frontend refuses a stale API contract instead of silently playing a fixed-order game',async()=>{
  const context={window:{},crypto:webcrypto,performance:{now:()=>0},setTimeout,clearTimeout,AbortController,sessionStorage:{getItem:()=>null,setItem:()=>{}},
    fetch:async()=>({ok:true,json:async()=>({question:{id:1},answered:0})})};
  vm.runInNewContext(await readFile('leaderboard.js','utf8'),context);
  await assert.rejects(context.window.GameAPI.start('24K-TEST'),error=>error.code==='DEPLOYMENT_OUTDATED');
});
