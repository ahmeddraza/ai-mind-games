(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const rounds = window.QUESTION_ROUNDS;
  const TOTAL_QUESTIONS = rounds.reduce((total, round) => total + round.count, 0);
  const POINTS_PER_ANSWER = 100;
  const MAX_SCORE = TOTAL_QUESTIONS * POINTS_PER_ANSWER;
  const DURATION = 60000;
  const ANSWER_DELAY = 400;
  const ROUND_TRANSITION = 900;
  const sound = window.GameAudio;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { screen: 'landing', round: 0, question: 0, score: 0, correct: 0, answered: 0, roll: '', deadline: 0, locked: false, resultId: null, newBest: false };
  let ticker = null, transition = null, lastTick = 60;
  const effectsTimers = new Set(), countFrames = new Map();
  let choices = [], assignedOrder = [], starting = false, finishing = false, activeQuestion = null, pendingAnswer = null, sessionVersion = 0;
  const api = window.GameAPI;
  const imageCache = new Map();
  function preloadImages() {
    const paths = window.QUESTION_IMAGES;
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
  function notice(message, retry) {
    const panel = $('connection-status');
    $('connection-text').textContent = message;
    $('connection-retry').hidden = !retry;
    $('connection-retry').onclick = retry || null;
    panel.hidden = !message;
  }
  function applyState(verified) {
    state.roll = verified.roll_number;
    state.score = verified.score;
    state.correct = verified.correct_answers;
    state.answered = verified.answered;
    state.deadline = verified.client_deadline;
    activeQuestion = verified.question;
    assignedOrder = verified.question_order || [];
    if (activeQuestion) { state.round = activeQuestion.round - 1; state.question = activeQuestion.round_question - 1; }
    $('player-label').textContent = `Roll No ${state.roll}`;
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
    sessionVersion++;
    starting = true; finishing = false; pendingAnswer = null;
    clearInterval(ticker); clearTimeout(transition); clearEffects(); sound.stop();
    sound.unlock().then(ready => { if (ready && (starting || ['intro', 'game'].includes(state.screen))) sound.play('start'); });
    const button = document.querySelector('.start-button');
    button.disabled = true; notice('Loading challenge images?');
    try {
      const loaded = await preloadImages();
      if (loaded.some(result => !result.loaded)) {
        loaded.filter(result => !result.loaded).forEach(result => imageCache.delete(result.path));
        throw new Error('A question image could not load. Check your connection and retry.');
      }
      const verified = await api.start(state.roll);
      notice(''); applyState(verified);
      if (verified.finished) { renderResults(verified.result); return; }
      Object.assign(state, { locked: false, resultId: null, newBest: false });
      lastTick = 60;
      $('score').textContent = state.score.toLocaleString();
      $('final-score').textContent = '0'; $('personal-best').hidden = true;
      $('question-dots').replaceChildren(); updateProgress();
      sound.setActive(true);
      ticker = setInterval(updateTimer, 80);
      if (state.answered === 0) showRoundIntro();
      else { renderQuestion(); showScreen('game'); updateTimer(); }
    } catch (error) {
      sound.stop(); showScreen('landing');
      notice(error.message, error.code === 'ALREADY_USED' ? null : startGame);
    } finally { starting = false; button.disabled = false; }
  }
  function showRoundIntro() {
    const round = rounds[state.round];
    $('intro-round').textContent = `Round ${state.round + 1}`;
    $('intro-title').textContent = round.title;
    $('intro-instructions').textContent = round.instructions;
    document.querySelector('.intro-meta').firstChild.textContent = `${round.count} QUESTIONS `;
    $('round-complete').hidden = state.round === 0;
    $('intro').classList.toggle('round-transfer', state.round === 1);
    showScreen('intro');
    if (state.round === 1) sound.play('round');
    animateClass(document.querySelector('.intro-card'), 'intro-reveal');
    const bar = document.querySelector('.intro-progress span');
    bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    transition = setTimeout(() => {
      if (performance.now() >= state.deadline) { finishGame(true); return; }
      renderQuestion(); showScreen('game'); updateTimer();
    }, state.round === 1 ? ROUND_TRANSITION : 1000);
  }
  function renderQuestion() {
    const round = rounds[state.round], question = activeQuestion;
    state.locked = false;
    $('round-label').textContent = `Round ${state.round + 1} of 2`;
    $('round-name').textContent = round.title;
    $('question-counter').textContent = `Question ${question.position || state.answered + 1} of ${TOTAL_QUESTIONS}`;
    $('question-category').textContent = state.round === 0 ? 'IDENTIFY THE PERSONALITY' : 'EXAMINE THE IMAGE';
    $('question-title').textContent = question.title;
    $('question-clue').textContent = question.clue;
    $('question-image').src = `assets/questions/${question.image}`;
    $('question-image').alt = state.round === 0 ? 'Mystery personality or fictional character' : 'Image to classify';
    $('key-count').textContent = question.options.length;
    $('answers').classList.toggle('binary', state.round === 1);
    $('game').classList.toggle('round-two', state.round === 1);
    $('answer-feedback').textContent = '';
    choices = question.options;
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
    const current = activeQuestion
      ? (activeQuestion.position || assignedOrder.indexOf(activeQuestion.id) + 1 || state.answered + 1) - 1
      : Math.max(0, state.answered - 1);
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
  async function answerQuestion(index) {
    if (state.screen !== 'game' || state.locked || finishing || state.answered >= TOTAL_QUESTIONS || !choices[index]) return;
    if (performance.now() >= state.deadline) { finishGame(); return; }
    state.locked = true;
    pendingAnswer = { question: activeQuestion.id, option: choices[index].id, index, round: state.round };
    [...$('answers').children].forEach(button => { button.disabled = true; });
    sound.unlock().then(() => sound.play('tap'));
    await submitPending();
  }
  async function submitPending() {
    if (!pendingAnswer || finishing || state.screen !== 'game') return;
    const pending = pendingAnswer;
    try {
      const verified = await api.answer(pending.question, pending.option);
      if (finishing || state.screen === 'results') return;
      notice('');
      const correct = verified.feedback?.question_id === pending.question && verified.feedback.correct;
      applyState(verified);
      countUp($('score'), state.score, 260);
      if (correct) { animateClass($('score-pop'), 'pop'); animateClass($('score'), 'score-bump'); }
      const button = $('answers').children[pending.index];
      button?.classList.add('selected', correct ? 'correct' : 'incorrect');
      $('answer-feedback').textContent = verified.feedback ? (correct ? 'Signal matched. +100 points' : 'Not this time. +0 points') : 'Time is up. Finalizing received answers?';
      if (verified.feedback) { sound.play(correct ? 'correct' : 'wrong'); if (correct) sound.play('point'); }
      updateProgress(); pendingAnswer = null;
      transition = setTimeout(() => {
        if (verified.finished) { clearInterval(ticker); renderResults(verified.result); return; }
        if (performance.now() >= state.deadline) { finishGame(); return; }
        if (state.round !== pending.round) showRoundIntro(); else renderQuestion();
      }, ANSWER_DELAY);
    } catch (error) {
      if (finishing || state.screen === 'results') return;
      if (['OUT_OF_ORDER', 'ANSWER_CONFLICT'].includes(error.code)) notice(error.message, restoreSession);
      else notice(error.message, submitPending);
    }
  }
  async function finishGame() {
    if (finishing || state.screen === 'results' || state.screen === 'landing') return;
    finishing = true; state.locked = true;
    clearInterval(ticker); clearTimeout(transition); clearEffects(); sound.stop();
    notice('Confirming your received answers with the server?');
    try {
      const verified = await api.finish();
      applyState(verified); pendingAnswer = null; notice(''); renderResults(verified.result);
    } catch (error) {
      finishing = false;
      if (error.code === 'TOO_EARLY') { await restoreSession(); return; }
      notice(error.message + ' Your attempt remains reserved.', finishGame);
    }
  }
  function renderResults(result) {
    clearInterval(ticker); clearTimeout(transition); clearEffects(); sound.stop();
    finishing = false; state.locked = true;
    state.score = result.score; state.correct = result.correct_answers; state.answered = result.answered;
    state.roll = result.roll_number; state.resultId = result.id; state.newBest = result.score >= MAX_SCORE * .8;
    $('timer-box').classList.remove('urgent');
    $('final-score').textContent = '0'; $('score').textContent = result.score.toLocaleString();
    $('personal-best').hidden = true;
    $('results-title').textContent = 'CHALLENGE COMPLETE';
    $('result-player').textContent = `PLAYER / ${result.roll_number}`;
    $('performance-feedback').textContent = result.score >= MAX_SCORE * .8 ? 'Exceptional pattern recognition. Your intuition is a force to be reckoned with.' : result.score >= MAX_SCORE * .5 ? 'A strong signal. You spotted the patterns and kept your cool under pressure.' : result.score >= MAX_SCORE * .25 ? 'Curiosity is your advantage. Another run could be your breakthrough.' : 'Every great mind starts with curiosity. Recalibrate, trust your instincts, and try again.';
    $('correct-count').textContent = result.correct_answers;
    $('incorrect-count').textContent = result.incorrect_answers;
    $('unanswered-count').textContent = result.unanswered_questions;
    $('answered-count').textContent = result.answered;
    $('total-count').textContent = result.total;
    $('accuracy').textContent = `${result.accuracy}%`;
    $('final-rank').textContent = result.rank ? `#${result.rank}` : '?';
    $('time-remaining').textContent = `${Math.floor(result.time_remaining / 60)}:${String(result.time_remaining % 60).padStart(2, '0')}`;
    $('finish-message').textContent = result.unanswered_questions ? `Time's up! ${result.answered} of ${result.total} answers received.` : `All ${result.total} answers received. That's some quick thinking!`;
    $('save-status').textContent = 'Verified score saved to the global leaderboard. One attempt per roll number.';
    showScreen('results'); countUp($('final-score'), result.score, 850);
    sound.play('end');
    if (state.newBest) { celebrate(); later(() => sound.play('high'), 550); }
    later(() => sound.stop(), 1700);
  }
  async function restoreSession() {
    const version = sessionVersion;
    try {
      const verified = await api.resume();
      if (version !== sessionVersion) return;
      if (verified.no_session) return;
      clearInterval(ticker); clearTimeout(transition);
      applyState(verified); pendingAnswer = null; finishing = false;
      notice('');
      if (verified.finished) { renderResults(verified.result); return; }
      state.locked = false; $('score').textContent = state.score.toLocaleString();
      renderQuestion(); showScreen('game');
      ticker = setInterval(updateTimer, 80); updateTimer();
    } catch (error) {
      if (version !== sessionVersion) return;
      if (error.code !== 'INVALID_SESSION') notice(error.message, restoreSession);
    }
  }
  async function openLeaderboard() {
    const modal = $('leaderboard-modal');
    if (!modal.open) modal.showModal();
    $('leaderboard-body').replaceChildren();
    $('leaderboard-note').textContent = 'Loading global scores?';
    $('leaderboard-retry').hidden = true;
    try {
      const { rows } = await api.leaderboard();
      $('leaderboard-body').replaceChildren(...rows.map(entry => {
        const tr = document.createElement('tr');
        if (entry.id === state.resultId) { tr.classList.add('current-player'); if (state.newBest) tr.classList.add('new-score-entry'); }
        [String(entry.rank).padStart(2, '0'), entry.roll_number, `${entry.score.toLocaleString()} / ${MAX_SCORE}`].forEach((value, column) => {
          const td = document.createElement('td'); td.textContent = value;
          if (column === 0 && entry.rank <= 3) td.className = 'rank-medal'; tr.append(td);
        });
        return tr;
      }));
      $('leaderboard-note').textContent = rows.length ? 'Global verified scores. Ties favor the earliest submission.' : 'No completed attempts yet. Be the first to finish!';
    } catch (error) { $('leaderboard-note').textContent = error.message; $('leaderboard-retry').hidden = false; }
  }
  $('start-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('roll-number');
    input.value = input.value.trim();
    if (!input.reportValidity()) return;
    state.roll = input.value.toUpperCase(); startGame();
  });
  $('play-again').addEventListener('click', () => { clearEffects(); sound.stop(); showScreen('landing'); $('roll-number').value = ''; notice('One attempt per roll number. Enter another player?s roll number.'); $('roll-number').focus(); });
  $('leaderboard-retry').addEventListener('click', openLeaderboard);
  $('back-home').addEventListener('click', () => { clearEffects(); sound.stop(); showScreen('landing'); notice(''); $('roll-number').focus(); });
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
  restoreSession();
})();
