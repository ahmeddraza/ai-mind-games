import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';

test('two-line clue migration changes only Round 1 wording, preserves saved attempts, and scores new sessions correctly', async () => {
  const app = await fixture({ databaseVersion: 5 });
  const { db } = app;
  const call = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args)).rows[0].value;
  const participants = async () => ({
    attempts: (await db.query('select * from mind_games_private.attempts order by roll_number')).rows,
    answers: (await db.query('select * from mind_games_private.answers order by roll_number, question_id')).rows,
    leaderboard: (await db.query('select * from public.leaderboard order by roll_number')).rows
  });
  try {
    const active = await call('mm_start_randomized', ['24K-CLUEACTIVE', 'a'.repeat(64)]);
    await call('mm_start_randomized', ['24K-CLUEDONE', 'b'.repeat(64)]);
    await db.exec("with t as(select clock_timestamp() t) update mind_games_private.attempts set started_at=t.t-interval '61 seconds',expires_at=t.t-interval '1 second' from t where roll_number='24KCLUEDONE'");
    await call('mm_finish', ['b'.repeat(64)]);
    const before = await participants();
    const old = (await db.query('select id, round_number, data from mind_games_private.questions order by id')).rows;
    const migration = await readFile('supabase/migrations/006_two_line_personality_clues.sql', 'utf8');
    await db.exec(migration);
    assert.deepEqual(await participants(), before, 'No participant rows or snapshots changed');
    const revised = (await db.query('select id, round_number, data from mind_games_private.questions order by id')).rows;
    const bank = JSON.parse(await readFile('server/question-bank.json', 'utf8')).flatMap(round => round.questions);
    for (let i = 0; i < 15; i++) {
      if (i < 10) {
        const { clue: originalClue, ...original } = old[i].data;
        const { clue, ...updated } = revised[i].data;
        assert.deepEqual(updated, original, 'Image, answer and options preserved');
        assert.equal(clue, bank[i].clue);
        assert.notEqual(clue, originalClue);
        assert.equal(clue.split('\n').length, 2);
        assert(clue.split('\n').every(line => line.length > 20));
        assert(!clue.toLowerCase().includes(updated.options[updated.answer].toLowerCase()), 'Clue does not name its answer');
      } else assert.deepEqual(revised[i], old[i], 'Round 2 untouched');
    }
    const resumed = await call('mm_state_randomized', ['a'.repeat(64)]);
    assert.deepEqual(resumed.question, active.question, 'Active attempt keeps its original clue');
    assert.equal(resumed.deadline, active.deadline);
    let state = await call('mm_start_randomized', ['24K-CLUENEW', 'c'.repeat(64)]);
    const saved = (await db.query("select snapshot from mind_games_private.attempts where roll_number='24KCLUENEW'")).rows[0].snapshot;
    for (const question of saved) {
      assert.equal(question.clue, bank[question.id - 1].clue);
      state = await call('mm_answer', ['c'.repeat(64), question.id, question.correct_option]);
    }
    assert.equal(state.result.score, 1500);
    assert.equal(state.result.correct_answers, 15);
    const after = await participants();
    await db.exec(migration);
    assert.deepEqual(await participants(), after, 'Rerun leaves attempts/results intact');
    assert.deepEqual((await db.query('select id, round_number, data from mind_games_private.questions order by id')).rows, revised);
  } finally { await app.close(); }
});
