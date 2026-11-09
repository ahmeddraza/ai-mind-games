# MIND vs MACHINE

AWS SBG FAST NUCES Karachi's HTML/CSS/vanilla-JavaScript arcade game, now using Vercel API functions and Supabase PostgreSQL for verified global scores.

**Setup and deployment:** follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md). It lists the exact SQL files, Vercel environment variables, deployment steps and testing checklist.

**Random-order repair for an existing deployment:** run only `supabase/migrations/005_randomization_readiness.sql` in Supabase, then redeploy this checkout on Vercel. This self-contained repair also works if migration 004 was missed. The API refuses an outdated database rather than silently starting a fixed-order game, and resumed attempts are labeled clearly. Do not rerun old migrations or reset the database. Existing attempts keep their saved order; new attempts get server-generated, independently shuffled 10-question and 5-question rounds and securely shuffled options. Identical random sequences across players are possible. Full upgrade steps are at the top of the setup guide.

- Round 1: 10 AI Personality questions.
- Round 2: 5 AI vs Human questions.
- One server-authoritative 60-second timer, starting at reservation and including intros.
- +100 per correct answer, zero for wrong answers, maximum 1500.
- One attempt per normalized roll; refresh recovers an existing attempt rather than restarting it.
- Randomized order is stored in each private session snapshot; scoring validates stable question IDs in the assigned sequence. Display progress is 1/15 through 15/15.
- Same questions, images, original AWS SBG theme, Web Audio effects and animations.
- Database-calculated results and a shared top-10 leaderboard; no local score submission.

After configuring Supabase and private local environment variables:

```text
npm ci
npm run dev
```

Frontend files remain plain HTML/CSS/JS. The only runtime package is the official server-side Supabase SDK. The build step copies public assets without a bundler. A simple static server cannot provide the secure game APIs.

```text
npm test
npm run build
```

Question content is maintained in `server/question-bank.json`. Migration `002_question_bank.sql` is the original seed; migration `006_two_line_personality_clues.sql` expands the ten Round 1 clues into two lines. For an existing deployment, run only migration 006 after 001-005, then redeploy; do not regenerate or rerun the original seed. Future live content changes should use a new numbered data migration. `questions.js` contains public display metadata and preload paths only. In-progress attempts keep immutable question snapshots. See `QUESTION_AUDIT.md` for the unchanged selected images and labels; that audit is excluded from the public deployment.

The roll reservation prevents repeated use of an identifier; it does **not** verify who owns that student roll number. No credentials, database keys, or authoritative answer-key files are included in the static output. The publishable key supplied in chat is not needed.
