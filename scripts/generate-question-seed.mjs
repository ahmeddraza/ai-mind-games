import { readFile, writeFile } from 'node:fs/promises';
const bank = JSON.parse(await readFile(new URL('../server/question-bank.json', import.meta.url), 'utf8'));
const rows = []; let id = 0;
bank.forEach((round, r) => round.questions.forEach((question, q) => {
  rows.push(`(${++id},${r + 1},${q + 1},'${JSON.stringify(question).replaceAll("'", "''")}'::jsonb)`);
}));
if (bank.length !== 2 || bank[0].questions.length !== 10 || bank[1].questions.length !== 5 || new Set(bank.flatMap(r => r.questions.map(q => q.image))).size !== 15) throw new Error('Expected 10+5 unique questions');
await writeFile(new URL('../supabase/migrations/002_question_bank.sql', import.meta.url), `-- Private answer key. Never copy this file into static output.\nbegin;\ninsert into mind_games_private.questions(id,round_number,round_question,data) values\n${rows.join(',\n')}\non conflict(id) do update set round_number=excluded.round_number,round_question=excluded.round_question,data=excluded.data;\ncommit;\n`);
