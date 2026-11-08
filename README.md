# MIND vs MACHINE

AWS SBG FAST NUCES Karachi's HTML/CSS/vanilla-JavaScript arcade game, now using Vercel API functions and Supabase PostgreSQL for verified global scores.

**Setup and deployment:** follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md). It lists the exact SQL files, Vercel environment variables, deployment steps and testing checklist.

- Round 1: 10 AI Personality questions.
- Round 2: 5 AI vs Human questions.
- One server-authoritative 60-second timer, starting at reservation and including intros.
- +100 per correct answer, zero for wrong answers, maximum 1500.
- One attempt per normalized roll; refresh recovers an existing attempt rather than restarting it.
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

Question content is preserved in `server/question-bank.json` and seeded by `supabase/migrations/002_question_bank.sql`. `questions.js` contains public display metadata and preload paths only. After deliberately editing the private bank, use `npm run seed:generate` and execute the updated seed SQL. In-progress attempts keep immutable question snapshots. See `QUESTION_AUDIT.md` for the unchanged selected images and labels; that audit is excluded from the public deployment.

The roll reservation prevents repeated use of an identifier; it does **not** verify who owns that student roll number. No credentials, database keys, or authoritative answer-key files are included in the static output. The publishable key supplied in chat is not needed.
