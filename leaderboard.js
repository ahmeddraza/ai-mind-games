/* Same-origin API transport. No Supabase key, answer key, or local score writes. */
window.GameAPI = (() => {
  const memory = new Map();
  function nonce(roll) {
    const key = `mm.start.${roll.replace(/[ -]/g, '').toUpperCase()}`;
    let value = memory.get(key);
    try { value = sessionStorage.getItem(key) || value; } catch (_) { /* Cookie recovery still works. */ }
    if (!value) value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    memory.set(key, value);
    try { sessionStorage.setItem(key, value); } catch (_) { /* Keep it in memory. */ }
    return value;
  }
  async function request(path, body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    const began = performance.now();
    try {
      const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.message || 'The request failed. Please retry.'); error.code = data.error; throw error; }
      if (path === 'start-game' && !data.no_session && data.randomization_version !== 2) {
        const error = new Error('This deployment is using an older game API. Redeploy the latest Vercel code, then refresh to resume this roll.');
        error.code = 'DEPLOYMENT_OUTDATED';
        throw error;
      }
      if (typeof data.server_now === 'number') data.client_deadline = performance.now() + Math.max(0, data.deadline - data.server_now - (performance.now() - began) / 2);
      return data;
    } catch (error) {
      if (!error.code) { error.message = 'Unable to reach the game server. Check your connection and retry.'; error.code = 'NETWORK_ERROR'; }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return { start: roll => request('start-game', { roll_number: roll, nonce: nonce(roll) }), resume: () => request('start-game', { resume: true }),
    answer: (question, option) => request('submit-answer', { question_id: question, option_id: option }), finish: () => request('finish-game', {}), leaderboard: () => request('leaderboard') };
})();
