# Supabase + Vercel setup

The existing game now uses same-origin Vercel API functions. The frontend is still HTML, CSS and vanilla JavaScript. The official Supabase JavaScript SDK runs only on the server. There is no frontend framework or bundler. The small build script copies an explicit public-file allowlist into `dist/`.

## Expand the Round 1 clues

For an existing installation with migrations 001-005 applied, run the full contents of **`supabase/migrations/006_two_line_personality_clues.sql`** in Supabase SQL Editor, then redeploy the frontend. This changes only the ten Round 1 clue strings. It does not change answers, images, scoring, database structure, or game functions. Do not rerun the original seed or reset participant data.

Each clue contains two short sentences separated by a line break; the frontend preserves that break and allows natural wrapping on mobile. Round 2 is unchanged. Existing attempts keep their saved clues; test the new wording with an unused roll number after the migration. Updating the private JSON file alone does not update a deployed database.

## Fix a deployment that still serves the original order

If migrations 001-003 are installed, **run only the full contents of `supabase/migrations/005_randomization_readiness.sql` in your Supabase SQL Editor**. This self-contained repair works whether migration 004 was applied or missed. Do not rerun older migrations, reseed questions, or reset attempts.

Then deploy the updated repository to the same Vercel project. Keep the existing `SUPABASE_URL` and server-key environment variables; no new environment variables, dependencies, extensions, or API routes are needed. The existing install/build/output settings remain `npm ci`, `npm run build`, and `dist`.

Exact upgrade sequence:

1. Run `npm ci`, `npm test`, and `npm run build` locally to validate the checkout.
2. Run migration **005 only**, once, in the existing Supabase project's SQL Editor as postgres. It also installs the secure shuffle definitions from 004 if they were missing.
3. Deploy this updated checkout through your existing Git-connected Vercel project, or run your normal Vercel production deployment. Deploy the SQL first; the existing frontend already submits stable IDs and remains compatible while the new frontend deploys.
4. Refresh the deployed site. Start two unused test roll numbers and compare assigned sequences. Refresh an active test session and confirm its sequence/deadline stay unchanged. Complete a session and check its verified global score.

The Start/resume API now calls versioned database functions and returns `randomization_version: 2`, `resumed`, and `order_type`. It refuses to serve a new game from an obsolete database function. If the migration is missing, the UI names the exact SQL file needed, and a new roll is not reserved. If an older game factory is accidentally restored later, the database readiness check rejects and rolls back its new reservation. The frontend also rejects an old API response instead of silently playing it. Script URLs are versioned to refresh cached game code.

**Testing the same roll is not a new shuffle.** The one-attempt rule means the same roll resumes its saved order and timer; the UI now explains this, including legacy sessions from before randomization. To test variation, start different unused roll numbers. Do not delete reservations to test this.

Migration 005 changes database functions only: it does not update/delete existing leaderboard rows, answers, reservations or snapshots. Active and completed pre-upgrade sessions keep their original sequence and option IDs. **Only new reservations get a new random order.** Existing rolls cannot be reused to request a reshuffle.

The server runs unbiased Fisher–Yates separately on the ten personality questions and five classification questions, and on each question's options. It obtains random integers from the random bits in PostgreSQL's `gen_random_uuid()`, rejecting samples outside an even multiple of each bound to avoid modulo bias. PostgreSQL's [UUID implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/uuid.c) uses `pg_strong_random` and sets UUID version/variant bits outside the first 32 bits used here. No browser-side shuffle or PostgreSQL `random()` is used for newly assigned orders.

The existing `mind_games_private.attempts.snapshot` JSON array stores each assigned order and correct-option mapping. API state includes a safe `question_order` list of stable IDs plus only the active question, with its 1–15 display `position`. Submission checks compare the submitted stable ID against the next snapshot question's ID, not against the display position or an answer letter. The complete answer key stays private. Equal permutations across different sessions remain mathematically possible and valid.

To inspect assigned IDs without selecting secret credentials or answer keys, use the SQL editor:

```sql
select a.roll_number,
       jsonb_agg((q.value->>'id')::integer order by q.ordinality) as assigned_order
from mind_games_private.attempts a,
     lateral jsonb_array_elements(a.snapshot) with ordinality q(value, ordinality)
group by a.roll_number;
```

## 1. Execute the SQL in Supabase

Open **your Supabase project → SQL Editor → New query**. Paste and run the **entire contents** of each file below, in this order, using the SQL editor's postgres role:

1. `supabase/migrations/001_secure_game.sql`
2. `supabase/migrations/002_question_bank.sql`
3. Enable **pg_cron** under **Database → Extensions**, then run `supabase/migrations/003_expiry_schedule.sql`.
4. `supabase/migrations/004_randomized_question_order.sql`
5. `supabase/migrations/005_randomization_readiness.sql`
6. `supabase/migrations/006_two_line_personality_clues.sql`

For a new installation, run all six files on the same project. For an existing installation, follow the upgrade section above instead. The second file contains the original 15-question answer key (migration 006 expands only the Round 1 clues) and belongs only in the database/private source, never in a public static folder. The third file finalizes abandoned expired attempts every minute. Leaderboard and session requests also finalize expired attempts, so the accepted-answer cutoff is always the original 60-second deadline, independent of cron timing. The expiry worker processes up to 100 overdue attempts per invocation; under larger backlogs allow subsequent batches or schedule it more often using Supabase Cron.

Migration 001 retains `public.leaderboard` and its existing ID type/default. It requires the columns `id`, `roll_number`, `score`, `correct_answers`, `created_at`. It normalizes valid roll numbers, adds uniqueness/scoring constraints, removes existing leaderboard policies, enables RLS, revokes public table access, and grants the game RPCs only to `service_role`. It does not delete or rescale existing leaderboard rows. If old rows violate scoring rules or collide after normalization, the transaction aborts. Review/export/archive those rows yourself, then retry. `id` must already have an identity/default generator if using an existing table.

Useful preflight checks (read-only):

```sql
select id, roll_number, score, correct_answers
from public.leaderboard
where score is null or correct_answers is null
   or score not between 0 and 1500
   or correct_answers not between 0 and 15
   or score <> correct_answers * 100;

select regexp_replace(upper(trim(roll_number)), '[ -]', '', 'g') as normalized_roll,
       count(*)
from public.leaderboard
group by 1 having count(*) > 1;
```

Check installation:

```sql
select count(*) from mind_games_private.questions; -- 15
select round_number, count(*) from mind_games_private.questions group by 1; -- 1:10, 2:5
select tablename, rowsecurity from pg_tables
where schemaname in ('public','mind_games_private')
  and tablename in ('leaderboard','questions','attempts','answers');
select jobname, schedule, active from cron.job where jobname='mind-machine-expiry';
```

Only the API's server credential can execute the five `public.mm_*` RPCs. `mind_games_private` contains the question bank, immutable per-attempt question/option snapshots, token hashes, deadlines and received answers. Do not expose this schema through the Data API or grant access to anon/authenticated roles.

## 2. Set Vercel environment variables

Under **Vercel project → Settings → Environment Variables**, configure:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your actual project URL copied from Supabase's project API settings. |
| `SUPABASE_SECRET_KEY` | Your private Supabase server secret key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional legacy alternative, used only if `SUPABASE_SECRET_KEY` is absent. |

Set these for the intended deployment environments, then redeploy. No `VITE_`, `NEXT_PUBLIC_`, publishable-key, browser SDK, or secret substitution into HTML is needed. The supplied publishable key is deliberately unused. `.env` and local env variants are ignored by Git; `.env.example` is an empty template. Never commit real credentials or place them in `assets/` or `dist/`.

## 3. Deploy to Vercel

1. Commit the application changes, migration files, `package.json`, `package-lock.json`, and `vercel.json` to your repository. Do not commit `.env.local`, `node_modules/`, `dist/`, or `.vercel/`.
2. Import that repository into Vercel, or redeploy the existing connected project.
3. Use the repository root as **Root Directory**, **Other** as the framework, and a supported **Node.js 22+** runtime.
4. The included `vercel.json` uses **Install: `npm ci`**, **Build: `npm run build`**, **Output: `dist`**. Do not configure an SPA rewrite that intercepts `/api/*`.
5. Configure the environment variables above and deploy.
6. Visit `/api/leaderboard` on the deployment: it should return `{ "rows": [...] }`, or an empty array before any completed attempts.
7. Play a test attempt on that deployment. Use the same deployed URL on another browser/device to verify shared scores.

The four HTTP routes are `POST /api/start-game`, `POST /api/submit-answer`, `POST /api/finish-game`, and `GET /api/leaderboard`. The fifth database RPC, `mm_state`, is called through start-game's credentialed resume operation; it is not another HTTP endpoint.

## Local development

Use Node.js 22+:

```text
npm ci
```

Privately create `.env.local` with your actual Supabase URL and server key (or use shell environment variables), run the SQL migrations on your test Supabase project, then:

```text
npm run dev
```

Open the printed localhost URL. Plain file opening and VS Code Live Server cannot run Vercel API functions and are no longer sufficient for scored play. `npm run dev` serves the unchanged static frontend and the same API handlers; there is no insecure offline/local-score fallback. You may alternatively use Vercel's local development tooling.

## Session and scoring behavior

- Roll numbers are trimmed, uppercased, and stripped of spaces/hyphens: `24k-2515`, `24K 2515`, and `24K2515` claim the same unique reservation.
- The database reserves the roll atomically at start and starts the 60-second clock immediately. The opening intro and round transition consume this same timer. Image preloading happens before reservation.
- A roll number is **not proof of student ownership**. This enforces one attempt per normalized identifier, not verified student identity. Someone who knows a roll number can reserve it; identity verification would require an additional authenticated enrollment flow. The API prevents fabricated scores, not outside help, bots, or knowledge of depicted characters.
- The server derives a 256-bit session credential using a random per-start nonce and the private server key. Only a SHA-256 credential hash is stored in the database. The credential is sent in an HttpOnly, SameSite=Strict cookie, with Secure enabled on Vercel/HTTPS.
- A per-roll random retry nonce is retained in sessionStorage before Start. It permits retrying a start whose response was lost, without a new reservation or reset. Treat it as sensitive recovery state. It is not a roll-ownership check.
- Refresh resumes the cookie's session with its original server deadline. Losing browser cookies and recovery state does not release the reservation. A different browser cannot claim the same used roll.
- Each server request receives only the active question and randomized option IDs. The browser never downloads the authoritative correct-option key. Do not publish private SQL, audits, or the server bank separately.
- Answers are serialized with a database row lock and checked against the database clock after taking the lock. Identical answer retries return the recorded result; changing a previously received answer is rejected. Later questions cannot be submitted early.
- All 15 received answers or timeout finalize the attempt. The server computes `score = correct_answers * 100`, limited by the schema to 0–1500. Early finish calls are rejected. Expiry never awards answers that the server has not accepted.
- Finishing is idempotent. The attempt, answers and final insert are in database transactions; finalization cannot produce a second leaderboard record.
- Results use verified server counts, accuracy, time remaining, score and rank. Music, effects and visual feedback are preserved. Another Player returns to roll entry; it cannot replay the same roll.
- Global scores sort by score descending, submission time ascending, then ID for deterministic equal timestamps. Local demo scores are neither trusted nor uploaded. Existing valid Supabase rows are preserved.

## Files created or modified

Modified: `index.html`, `style.css`, `script.js`, `questions.js`, `leaderboard.js`, `README.md`.

Created:

- `api/start-game.js`, `api/submit-answer.js`, `api/finish-game.js`, `api/leaderboard.js`
- `server/db.js`, `server/http.js`, `server/question-bank.json`
- `supabase/migrations/001_secure_game.sql`, `002_question_bank.sql`, `003_expiry_schedule.sql`, `004_randomized_question_order.sql`, `005_randomization_readiness.sql`
- `scripts/prepare-static.mjs`, `scripts/dev-server.mjs`, `scripts/generate-question-seed.mjs`
- `tests/database.test.mjs`, `tests/api.test.mjs`, `tests/build.test.mjs`, `tests/fixture.mjs`, `tests/randomization.test.mjs`, `tests/readiness.test.mjs`
- `package.json`, `package-lock.json`, `vercel.json`, `.gitignore`, `.env.example`, `SUPABASE_SETUP.md`

The authoritative question data moved unchanged into the private bank. Audio and image files were not modified. No real `.env` file, server key, database credential, or Git commit was created.

## Automated checks and deployment checklist

Run `npm test` and `npm run build`. Automated database/API tests use PGlite's local PostgreSQL engine plus the real Supabase SDK with a local REST transport. They do **not** claim to connect to your live Supabase project. Browser checks used Chrome, real clicks and Web Audio signal measurements against that local integration fixture.

Before event use on the deployed site, check:

- [ ] SQL 001-006 are installed and the expiry cron job is active. Existing deployments apply only the missing upgrade files: 005 for the random-order repair, then 006 for expanded clues.
- [ ] Env variables are configured and `/api/leaderboard` responds successfully.
- [ ] Two browser/device sessions display the same global leaderboard.
- [ ] The same normalized roll is rejected in a fresh/incognito session, even after timeout.
- [ ] Simultaneous starts for one normalized roll allow only one reservation; concurrent finish calls create one final row.
- [ ] Refresh during an attempt continues the timer and received-answer count.
- [ ] A lost answer response can Retry without earning points twice.
- [ ] All 15 images/questions work; Round 2 starts at question 11 and does not reset time.
- [ ] New sessions can have different question orders, each containing ten distinct Round 1 IDs followed by five distinct Round 2 IDs.
- [ ] Refresh preserves the full assigned sequence and shuffled options; an existing roll cannot obtain a fresh order.
- [ ] Attempts started before the random-order update retain their saved snapshots and existing scores remain intact.
- [ ] A perfect run earns 1500; wrong answers earn zero; partial timeout reports unanswered questions.
- [ ] POST finish with `{ "score": 1500 }` is rejected; repeated valid finish requests return the same row.
- [ ] The publishable/anon key cannot directly insert/update/delete `public.leaderboard` or call game RPCs.
- [ ] Browser source, `dist/`, network responses, and publicly requested paths do not expose server keys or answer-key files.
- [ ] Sound, mute persistence, animation, mobile layouts and reduced-motion support remain working.

Use designated test roll numbers or a separate Supabase test project: each test start consumes that roll's one attempt. Configure any event-level abuse controls on Vercel as appropriate; this implementation does not assert student ownership.

Official references: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase JavaScript client](https://supabase.com/docs/reference/javascript/initializing), [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js).
