(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const rounds = window.QUESTION_ROUNDS;
  const TOTAL_QUESTIONS = rounds.reduce((total, round) => total + round.questions.length, 0);
  const POINTS_PER_ANSWER = 100;
  const MAX_SCORE = TOTAL_QUESTIONS * POINTS_PER_ANSWER;
  const DURATION = 60000;
  const ANSWER_DELAY = 400;
  const ROUND_TRANSITION = 900;
  const sound = window.GameAudio;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { screen: 'landing', round: 0, question: 0, score: 0, correct: 0, answered: 0, roll: '', deadline: 0, locked: false, resultId: null, newBest: false };
  let ticker = null, transition = null, firstStart = 0, lastTick = 60;
  const effectsTimers = new Set(), countFrames = new Map();
  let choices = [], starting = false;
  const imageCache = new Map();
  function preloadImages() {
    const paths = [...new Set(rounds.flatMap(round => round.questions.map(question => question.image)))];
    return Promise.all(paths.map(path => {
      if (!imageCache.has(path)) {
        imageCache.set(path, new Promise(resolve => {
          const image = new Image();
          const timeout = setTimeout(() => resolve({ path, loaded: false }), 10000);
          const done = loaded => { clearTimeout(timeout); resolve({ path, loaded, image }); };
          image.onload = () => done(image.naturalWidth > 0);
          image.onerror = () => done(false);
          image.src = `assets/questions/${path}`;
        }));
      }
      return imageCache.get(path);
    }));
  }
  function shuffledOptions(question) {
    const options = question.options.map((text, originalIndex) => ({ text, originalIndex }));
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return options;
  }

  function showScreen(name) {
    ['landing', 'intro', 'game', 'results'].forEach(id => { $(id).hidden = id !== name; });
    state.screen = name;
    window.scrollTo(0, 0);
  }
  function later(callback, delay) {
    const id = setTimeout(() => { effectsTimers.delete(id); callback(); }, delay);
    effectsTimers.add(id);
  }
  function animateClass(element, name) {
    element.classList.remove(name);
    void element.offsetWidth;
    element.classList.add(name);
  }
  function countUp(element, value, duration = 300) {
    cancelAnimationFrame(countFrames.get(element));
    const from = Number(element.textContent.replace(/,/g, '')) || 0;
    if (reducedMotion.matches) { element.textContent = value.toLocaleString(); return; }
    const began = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - began) / duration);
      element.textContent = Math.round(from + (value - from) * (1 - (1 - progress) ** 3)).toLocaleString();
      if (progress < 1) countFrames.set(element, requestAnimationFrame(frame));
      else countFrames.delete(element);
    };
    countFrames.set(element, requestAnimationFrame(frame));
  }
  function clearEffects() {
    effectsTimers.forEach(clearTimeout); effectsTimers.clear();
    countFrames.forEach(cancelAnimationFrame); countFrames.clear();
    $('confetti').replaceChildren();
    $('score-pop').classList.remove('pop');
    $('score').classList.remove('score-bump');
  }
  function syncAudioControls() {
    document.querySelectorAll('[data-sound-toggle]').forEach(button => {
      button.textContent = sound.isMuted() ? 'Sound OFF' : 'Sound ON';
      button.setAttribute('aria-pressed', String(!sound.isMuted()));
      button.setAttribute('aria-label', sound.isMuted() ? 'Enable sound' : 'Mute sound');
    });
    document.querySelectorAll('[data-music-toggle]').forEach(button => {
      button.textContent = sound.hasMusic() ? 'Music ON' : 'Music OFF';
      button.setAttribute('aria-pressed', String(sound.hasMusic()));
      button.setAttribute('aria-label', sound.hasMusic() ? 'Disable background music' : 'Enable background music');
    });
  }
  function celebrate() {
    if (reducedMotion.matches) return;
    $('confetti').replaceChildren(...Array.from({ length: 36 }, (_, index) => {
      const piece = document.createElement('i');
      piece.style.cssText = `--x:${(index * 17.3) % 100}vw;--drift:${(index % 7 - 3) * 35}px;--delay:${index % 6 * 45}ms;--color:${['#22d3a0', '#38bdf8', '#a78bfa'][index % 3]};--spin:${index % 2 ? 400 : -400}deg`;
      return piece;
    }));
    later(() => $('confetti').replaceChildren(), 2200);
  }
  function updateTimer() {
    const remaining = Math.max(0, state.deadline - performance.now());
    const seconds = Math.ceil(remaining / 1000);
    $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('timer-ring').style.strokeDashoffset = String(100 - remaining / DURATION * 100);
    $('timer-box').setAttribute('aria-label', `${seconds} seconds remaining`);
    $('timer-box').classList.toggle('urgent', seconds <= 10);
    $('timer-box').style.setProperty('--pulse-speed', seconds <= 3 ? '.45s' : '.85s');
    if (seconds > 0 && seconds <= 10 && seconds !== lastTick) sound.play('tick', seconds);
    lastTick = seconds;
    if (remaining <= 0) finishGame(true);
  }
  async function startGame() {
    if (starting) return;
    starting = true;
    clearEffects(); sound.stop();
    // Unlock before the first await so browsers retain the Start click activation.
    sound.unlock().then(ready => {
      if (ready && (starting || ['intro', 'game'].includes(state.screen))) {
        sound.play('start');
        sound.setActive(['intro', 'game'].includes(state.screen));
      }
    });
    const startButton = document.querySelector('.start-button');
    const replayButton = $('play-again');
    startButton.disabled = replayButton.disabled = true;
    $('roll-help').textContent = 'Loading challenge images…';
    const loaded = await preloadImages();
    starting = false;
    startButton.disabled = replayButton.disabled = false;
    if (loaded.some(result => !result.loaded)) {
      loaded.filter(result => !result.loaded).forEach(result => imageCache.delete(result.path));
      showScreen('landing');
      $('roll-help').textContent = 'A challenge image could not load. Check the asset folder and try again.';
      return;
    }
    $('roll-help').textContent = '3–20 letters, digits, spaces or hyphens.';
    clearInterval(ticker); clearTimeout(transition);
    Object.assign(state, { round: 0, question: 0, score: 0, correct: 0, answered: 0, deadline: 0, locked: false, resultId: null, newBest: false });
    firstStart = 0;
    lastTick = 60;
    $('score').textContent = '0';
    $('final-score').textContent = '0';
    $('personal-best').hidden = true;
    $('timer-box').classList.remove('urgent');
    $('timer').textContent = '1:00';
    $('timer-ring').style.strokeDashoffset = '0';
    $('question-dots').replaceChildren();
    updateProgress();
    sound.setActive(true);
    $('player-label').textContent = `Roll No ${state.roll}`;
    showRoundIntro();
  }
  function showRoundIntro() {
    const round = rounds[state.round];
    $('intro-round').textContent = `Round ${state.round + 1}`;
    $('intro-title').textContent = round.title;
    $('intro-instructions').textContent = round.instructions;
    document.querySelector('.intro-meta').firstChild.textContent = `${round.questions.length} QUESTIONS `;
    $('round-complete').hidden = state.round === 0;
    $('intro').classList.toggle('round-transfer', state.round === 1);
    showScreen('intro');
    if (state.round === 1) sound.play('round');
    animateClass(document.querySelector('.intro-card'), 'intro-reveal');
    const bar = document.querySelector('.intro-progress span');
    bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    transition = setTimeout(() => {
      if (!state.deadline) {
        firstStart = performance.now();
        state.deadline = firstStart + DURATION;
        ticker = setInterval(updateTimer, 80);
      }
      if (performance.now() >= state.deadline) { finishGame(true); return; }
      renderQuestion(); showScreen('game'); updateTimer();
    }, state.round === 1 ? ROUND_TRANSITION : 1000);
  }
  function renderQuestion() {
    const round = rounds[state.round], question = round.questions[state.question];
    state.locked = false;
    $('round-label').textContent = `Round ${state.round + 1} of 2`;
    $('round-name').textContent = round.title;
    $('question-counter').textContent = `Question ${state.question + 1} of ${round.questions.length}`;
    $('question-category').textContent = state.round === 0 ? 'IDENTIFY THE PERSONALITY' : 'EXAMINE THE IMAGE';
    $('question-title').textContent = question.title;
    $('question-clue').textContent = question.clue;
    $('question-image').src = `assets/questions/${question.image}`;
    $('question-image').alt = state.round === 0 ? 'Mystery personality or fictional character' : 'Image to classify';
    $('key-count').textContent = question.options.length;
    $('answers').classList.toggle('binary', state.round === 1);
    $('game').classList.toggle('round-two', state.round === 1);
    $('answer-feedback').textContent = '';
    choices = shuffledOptions(question);
    $('answers').replaceChildren(...choices.map(({ text: option }, index) => {
      const button = document.createElement('button');
      button.className = 'answer'; button.type = 'button';
      button.style.setProperty('--answer-delay', `${index * 35}ms`);
      const letter = document.createElement('span'); letter.className = 'answer-letter'; letter.textContent = state.round === 1 ? (option === 'AI GENERATED' ? '⌘' : '▣') : String(index + 1).padStart(2, '0');
      letter.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'answer-text'; label.textContent = answerLabel(option);
      button.append(letter, label);
      button.setAttribute('aria-label', `${index + 1}: ${answerLabel(option)}`);
      button.addEventListener('click', () => answerQuestion(index));
      return button;
    }));
    updateProgress();
    animateClass(document.querySelector('.visual-card'), 'question-enter');
    animateClass(document.querySelector('.question-panel'), 'question-enter');
  }
  function answerLabel(option) {
    return option;
  }
  function updateProgress() {
    const current = rounds.slice(0, state.round).reduce((total, round) => total + round.questions.length, 0) + state.question;
    $('overall-progress').replaceChildren(document.createTextNode(String(current + 1).padStart(2, '0') + ' '));
    const total = document.createElement('small'); total.textContent = `/ ${TOTAL_QUESTIONS}`; $('overall-progress').append(total);
    $('question-dots').style.setProperty('--total-questions', TOTAL_QUESTIONS);
    if (!$('question-dots').children.length) $('question-dots').replaceChildren(...Array.from({ length: TOTAL_QUESTIONS }, () => document.createElement('i')));
    [...$('question-dots').children].forEach((dot, index) => {
      const wasDone = dot.classList.contains('done');
      dot.className = index < state.answered ? 'done' : index === current ? 'active' : '';
      if (!wasDone && index < state.answered) dot.classList.add('just-completed');
    });
    $('question-dots').setAttribute('aria-label', `${state.answered} of ${TOTAL_QUESTIONS} answered. Current challenge ${current + 1}.`);
  }
  function answerQuestion(index) {
    if (state.screen !== 'game' || state.locked || state.answered >= TOTAL_QUESTIONS) return;
    if (performance.now() >= state.deadline) { finishGame(true); return; }
    const question = rounds[state.round].questions[state.question];
    if (index < 0 || index >= question.options.length) return;
    state.locked = true;
    const correct = choices[index].originalIndex === question.answer;
    state.answered++;
    if (correct) { state.score += POINTS_PER_ANSWER; state.correct++; }
    countUp($('score'), state.score, 260);
    if (correct) {
      animateClass($('score-pop'), 'pop');
      animateClass($('score'), 'score-bump');
    }
    const buttons = [...$('answers').children];
    buttons.forEach(button => { button.disabled = true; });
    buttons[index].classList.add('selected', correct ? 'correct' : 'incorrect');
    $('answer-feedback').textContent = correct ? 'Signal matched. +100 points' : 'Not this time. +0 points';
    updateProgress();
    sound.play('tap');
    sound.play(correct ? 'correct' : 'wrong');
    if (correct) sound.play('point');
    transition = setTimeout(() => {
      if (state.answered === TOTAL_QUESTIONS) { finishGame(false); return; }
      if (performance.now() >= state.deadline) { finishGame(true); return; }
      state.question++;
      if (state.question === rounds[state.round].questions.length) {
        state.round++; state.question = 0;
        if (state.round === rounds.length) { finishGame(false); return; }
        showRoundIntro();
      } else renderQuestion();
    }, ANSWER_DELAY);
  }
  function finishGame(timedOut) {
    if (state.screen === 'results' || state.screen === 'landing') return;
    timedOut = timedOut && state.answered < TOTAL_QUESTIONS;
    clearInterval(ticker); clearTimeout(transition); state.locked = true;
    clearEffects(); sound.stop();
    $('timer-box').classList.remove('urgent');
    const remaining = Math.max(0, Math.ceil((state.deadline - performance.now()) / 1000));
    const previous = window.Leaderboard.read().filter(entry => entry.roll === state.roll);
    state.newBest = state.score > Math.max(0, ...previous.map(entry => entry.score));
    const result = window.Leaderboard.save(state.roll, state.score);
    state.resultId = result.id;
    $('final-score').textContent = '0';
    $('score').textContent = state.score.toLocaleString();
    $('personal-best').hidden = !state.newBest;
    $('results-title').textContent = 'CHALLENGE COMPLETE';
    $('result-player').textContent = `PLAYER / ${state.roll}`;
    $('performance-feedback').textContent = state.score >= MAX_SCORE * .8 ? 'Exceptional pattern recognition. Your intuition is a force to be reckoned with.' : state.score >= MAX_SCORE * .5 ? 'A strong signal. You spotted the patterns and kept your cool under pressure.' : state.score >= MAX_SCORE * .25 ? 'Curiosity is your advantage. Another run could be your breakthrough.' : 'Every great mind starts with curiosity. Recalibrate, trust your instincts, and try again.';
    $('correct-count').textContent = state.correct;
    $('incorrect-count').textContent = state.answered - state.correct;
    $('unanswered-count').textContent = TOTAL_QUESTIONS - state.answered;
    $('answered-count').textContent = state.answered;
    $('total-count').textContent = TOTAL_QUESTIONS;
    $('accuracy').textContent = `${state.answered ? Math.round(state.correct / state.answered * 100) : 0}%`;
    $('final-rank').textContent = result.rank ? `#${result.rank}` : '—';
    $('time-remaining').textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    $('finish-message').textContent = timedOut ? `Time's up! You answered ${state.answered} of ${TOTAL_QUESTIONS} questions.` : `All ${TOTAL_QUESTIONS} answered. That's some quick thinking!`;
    $('save-status').textContent = result.persistent ? 'Score saved on this browser. Your next personal best is waiting.' : 'Browser storage is unavailable. Your score is kept for this session.';
    showScreen('results');
    countUp($('final-score'), state.score, 850);
    sound.play('end');
    if (state.score >= MAX_SCORE * .8 || state.newBest) {
      celebrate(); later(() => sound.play('high'), 550);
    }
    later(() => sound.stop(), 1700);
  }
  function openLeaderboard() {
    const rows = window.Leaderboard.read().slice(0, 10);
    $('leaderboard-body').replaceChildren(...rows.map((entry, index) => {
      const tr = document.createElement('tr');
      if (entry.id === state.resultId) {
        tr.classList.add('current-player');
        if (state.newBest) tr.classList.add('new-score-entry');
      }
      [String(index + 1).padStart(2, '0'), entry.roll, `${entry.score.toLocaleString()} / ${MAX_SCORE}`].forEach((value, column) => {
        const td = document.createElement('td'); td.textContent = value;
        if (column === 0 && index < 3) td.className = 'rank-medal'; tr.append(td);
      });
      return tr;
    }));
    $('leaderboard-note').textContent = `Local ${TOTAL_QUESTIONS}-question leaderboard · Includes 3 sample scores. Repeat plays are separate entries. ${window.Leaderboard.isPersistent() ? 'Scores are stored only on this browser. Previous-format scores remain saved separately.' : 'Storage is unavailable; scores last for this session only.'}`;
    $('leaderboard-modal').showModal();
  }
  $('start-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('roll-number');
    input.value = input.value.trim();
    if (!input.reportValidity()) return;
    state.roll = input.value.toUpperCase(); startGame();
  });
  $('play-again').addEventListener('click', startGame);
  $('back-home').addEventListener('click', () => { clearEffects(); sound.stop(); showScreen('landing'); $('roll-number').focus(); });
  document.querySelectorAll('.leaderboard-trigger').forEach(button => button.addEventListener('click', openLeaderboard));
  $('close-leaderboard').addEventListener('click', () => $('leaderboard-modal').close());
  $('leaderboard-modal').addEventListener('click', event => { if (event.target === $('leaderboard-modal')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  document.querySelectorAll('[data-sound-toggle]').forEach(button => button.addEventListener('click', () => {
    sound.setMuted(!sound.isMuted()); syncAudioControls();
    if (!sound.isMuted()) sound.unlock().then(() => { sound.play('tap'); sound.setActive(['game', 'intro'].includes(state.screen)); });
  }));
  document.querySelectorAll('[data-music-toggle]').forEach(button => button.addEventListener('click', () => {
    sound.setMusic(!sound.hasMusic());
    if (sound.hasMusic()) sound.setMuted(false);
    syncAudioControls();
    sound.unlock().then(() => { sound.play('tap'); sound.setActive(['game', 'intro'].includes(state.screen)); });
  }));
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && !button.disabled && !button.matches('.answer,.start-button,#play-again,[data-sound-toggle],[data-music-toggle]')) sound.play('tap');
  });
  document.addEventListener('keydown', event => {
    if (state.screen !== 'game' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || $('leaderboard-modal').open) return;
    const index = '1234'.indexOf(event.key);
    if (index >= 0) { event.preventDefault(); answerQuestion(index); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { sound.hide(); return; }
    if (state.deadline && ['game', 'intro'].includes(state.screen)) updateTimer();
    sound.restore();
  });
  window.addEventListener('pagehide', () => { clearInterval(ticker); clearTimeout(transition); clearEffects(); sound.stop(); sound.hide(); });
  syncAudioControls();
  // Start warming the cache immediately. The clock starts only after loading and the intro.
  preloadImages();
})();
