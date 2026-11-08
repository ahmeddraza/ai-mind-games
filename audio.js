/* Original synthesized arcade sounds. No audio assets or autoplay on page load. */
window.GameAudio = (() => {
  'use strict';
  const read = (key, fallback) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) { /* Session preferences still work. */ } };
  let muted = read('mind-machine.muted', false);
  let music = read('mind-machine.music', false);
  let context, master, compressor, musicTimer = null, nextBeat = 0, beat = 0, active = false;
  const voices = new Set();

  function unlock() {
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return Promise.resolve(false);
        context = new Audio();
        master = context.createGain();
        master.gain.value = muted ? 0 : .32;
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -20; compressor.knee.value = 20;
        compressor.ratio.value = 8; compressor.attack.value = .003; compressor.release.value = .15;
        master.connect(compressor); compressor.connect(context.destination);
      }
      // Called synchronously from Start/toggle handlers, before image-loading awaits.
      return context.resume().then(() => context.state === 'running').catch(() => false);
    } catch (_) { return Promise.resolve(false); }
  }
  function tone(frequency, delay = 0, duration = .12, volume = .12, type = 'sine', endFrequency = frequency, group = 'effect') {
    if (!context || context.state !== 'running' || muted || voices.size >= 20) return;
    const time = context.currentTime + delay;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(master);
    const voice = { oscillator, gain, group };
    voices.add(voice);
    oscillator.onended = () => { voices.delete(voice); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(time); oscillator.stop(time + duration + .01);
  }
  function stopVoices(group) {
    if (!context) return;
    for (const voice of [...voices]) {
      if (group && voice.group !== group) continue;
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setTargetAtTime(.0001, context.currentTime, .006);
      try { voice.oscillator.stop(context.currentTime + .025); } catch (_) { /* Already ended. */ }
    }
  }
  function play(name, urgency = 10) {
    if (!context || muted || context.state !== 'running' || document.hidden) return;
    switch (name) {
      case 'start':
        tone(110, 0, .3, .17, 'triangle', 440);
        [440, 660, 880].forEach((note, i) => tone(note, .12 + i * .075, .13, .10)); break;
      case 'tap': tone(1150, 0, .035, .065, 'sine', 700); break;
      case 'correct': tone(660, 0, .15, .16); tone(990, .105, .2, .13); break;
      case 'wrong': tone(190, 0, .19, .12, 'triangle', 85); break;
      case 'point': tone(1480, .22, .07, .065, 'square', 1980); break;
      case 'round': tone(160, 0, .38, .10, 'triangle', 1800); tone(900, .17, .22, .06, 'sine', 240); break;
      case 'tick': tone(urgency <= 3 ? 1050 : 740, 0, .045, urgency <= 3 ? .09 : .045); if (urgency <= 3) tone(920, .16, .035, .04); break;
      case 'end': [440, 330, 220].forEach((note, i) => tone(note, i * .12, .18, .11, 'triangle')); break;
      case 'high': [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => tone(note, i * .11, .25, .12)); tone(783.99, .38, .32, .07); break;
    }
  }
  function stopMusic() {
    clearTimeout(musicTimer); musicTimer = null; stopVoices('music');
  }
  function startMusic() {
    stopMusic();
    if (!active || !music || muted || !context || context.state !== 'running' || document.hidden) return;
    beat = 0; nextBeat = context.currentTime + .05;
    // An original eight-step, sparse sine/triangle sequence; deliberately quiet.
    const notes = [130.81, 196, 164.81, 261.63, 146.83, 220, 196, 164.81];
    const schedule = () => {
      if (!active || !music || muted || document.hidden) return;
      while (nextBeat < context.currentTime + .22) {
        tone(notes[beat % notes.length], Math.max(0, nextBeat - context.currentTime), .25, .022, 'sine', notes[beat % notes.length], 'music');
        beat++; nextBeat += .375;
      }
      musicTimer = setTimeout(schedule, 100);
    };
    schedule();
  }
  function setActive(value) { active = value; if (value) startMusic(); else stopMusic(); }
  function stop() { active = false; stopMusic(); stopVoices(); }
  function setMuted(value) {
    muted = value; write('mind-machine.muted', muted);
    if (master) { master.gain.cancelScheduledValues(context.currentTime); master.gain.setTargetAtTime(muted ? 0 : .32, context.currentTime, .01); }
    if (muted) { stopMusic(); stopVoices(); } else startMusic();
  }
  function setMusic(value) { music = value; write('mind-machine.music', music); if (value) startMusic(); else stopMusic(); }
  function hide() { stopMusic(); stopVoices(); if (context) context.suspend().catch(() => {}); }
  function restore() { if (context && !muted) context.resume().then(startMusic).catch(() => {}); }
  return { unlock, play, stop, setActive, setMuted, setMusic, hide, restore, isMuted: () => muted, hasMusic: () => music };
})();
