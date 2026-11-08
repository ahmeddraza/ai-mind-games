/* Local demo only. Replace this adapter when a shared leaderboard is available. */
window.Leaderboard = (() => {
  // Keep earlier-format scores untouched in their original storage key. Scores from
  // different question counts are not comparable, so this format has its own board.
  const KEY = 'ai-mind-games.leaderboard.v2-15';
  const MAX_SCORE = window.QUESTION_ROUNDS.reduce((total, round) => total + round.questions.length, 0) * 100;
  const demo = [
    { id: 'demo-1', roll: '24K-1024', score: 1500 },
    { id: 'demo-2', roll: '23K-2048', score: 1300 },
    { id: 'demo-3', roll: '25K-0512', score: 1100 }
  ];
  let memory = [];
  let persistent = true;
  const valid = row => row && typeof row.id === 'string' && typeof row.roll === 'string' && row.roll.length <= 20 && Number.isInteger(row.score) && row.score >= 0 && row.score <= MAX_SCORE;
  function read() {
    if (!persistent) return [...demo, ...memory].sort((a, b) => b.score - a.score || (a.date || 0) - (b.date || 0));
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      memory = Array.isArray(parsed) ? parsed.filter(valid).slice(0, 200) : [];
    } catch (_) { persistent = false; }
    return [...demo, ...memory].sort((a, b) => b.score - a.score || (a.date || 0) - (b.date || 0));
  }
  function save(roll, score) {
    if (typeof roll !== 'string' || !roll || roll.length > 20 || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) throw new RangeError('Invalid leaderboard entry');
    read();
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, roll, score, date: Date.now() };
    memory.push(entry);
    memory.sort((a, b) => b.score - a.score || a.date - b.date);
    memory = memory.slice(0, 200);
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (_) { persistent = false; }
    const rows = [...demo, ...memory].sort((a, b) => b.score - a.score || (a.date || 0) - (b.date || 0));
    const position = rows.findIndex(row => row.id === entry.id);
    return { id: entry.id, rank: position < 0 ? null : position + 1, persistent };
  }
  return { read, save, isPersistent: () => persistent };
})();
