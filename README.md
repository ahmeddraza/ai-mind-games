# MIND vs MACHINE

A build-free browser arcade game for AWS SBG, FAST NUCES Karachi. HTML, CSS and vanilla JavaScript only; no npm, frameworks, build steps or external audio files.

## Run

Open `index.html` in a modern browser or run `python -m http.server 8000` from this directory and visit `http://localhost:8000`. VS Code Live Server also works.

## Rules

- Round 1: AI Personality, questions 1-10, four shuffled choices.
- Round 2: AI vs Human, questions 11-15, two shuffled choices.
- Exactly 15 distinct images and questions; no repeated images.
- Correct answers: +100. Wrong answers: 0. Maximum score: 1500.
- One 60-second timer starts after the one-second opening introduction and runs continuously through answer feedback and the 900 ms round transition.
- The game ends after question 15 or when time expires. Feedback lasts 400 ms and duplicate answers are blocked.
- Click an option or press 1-4 (1-2 in Round 2); shortcuts follow the displayed positions.

## Images and questions

All data is in `questions.js`; image paths are relative to `assets/questions/`. The actual personality directory is `ai-personality/`. It contains exactly ten images, including the new Spider-Man, Jack Sparrow, Elsa and Morpheus files. The user explicitly confirmed Morpheus as the intended answer for `Morpheus.jpeg` despite the stylized picture resembling Neo.

Round 2 uses the five actual files under `ai-vs-human/`. Its labels come from supplied ai/real filenames. The user previously confirmed the human-made portrait artwork in `real_image.jpg` counts as REAL PHOTO, so the round instructions explain that this option includes human-made artwork. Labels are never inferred from appearance.

Images preload before the clock starts. A loading failure blocks a new game and shows a retry message. Alt text and headings do not disclose the identity. The legacy SVG placeholders remain untouched and unused. See `QUESTION_AUDIT.md` for exact selected paths, clues, answers and label rationale.

## Results and leaderboard

CHALLENGE COMPLETE shows the roll number, animated score out of 1500, correct/incorrect/unanswered counts, total and answered counts, accuracy based on answered questions, time remaining, rank and performance feedback. Zero answered questions gives 0% accuracy. Unanswered questions are total minus submitted answers; they do not count as incorrect.

The localStorage leaderboard saves actual scores and roll numbers, sorts descending, shows the top ten and retains up to 200 plays. Ties favor the earlier entry. It includes three labeled-in-the-description sample scores. It is local to the browser and origin, with session memory fallback if storage is unavailable.

The current 15-question format uses `ai-mind-games.leaderboard.v2-15`. Earlier-format scores remain untouched under their original key and are not rescaled or mixed into this board. No backend is used.

## Sound and motion

`audio.js` uses Web Audio for activation, tap, correct chime, error, points, round whoosh, urgent countdown, ending and celebration. The AudioContext initializes/resumes synchronously from Start before image loading. Sound defaults to ON after Start unless a saved mute preference overrides it. Optional quiet original electronic music defaults to OFF. Both preferences are saved locally.

The existing navy/emerald/cyan/violet AWS SBG theme, unchanged logo, circuits, particles, question/image/answer entrances, score pops and count-ups, progress animation, timer pulse and results celebrations are preserved. A score at or above 80% of the maximum or a new personal best triggers confetti. Reduced-motion preferences disable decorative animation and update scores immediately.

Music and countdown audio stop at game end; short ending cues complete within 1.7 seconds. Replay clears delayed effects, count-ups, confetti and old audio. Hidden tabs suspend audio while the timer continues.
