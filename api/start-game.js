import { endpoint, send, rpc, credential, hash, deriveCredential, cookieHeader, normalizeRoll, fields } from '../server/http.js';
export default endpoint('POST', async (req, res, db) => {
  fields(req.body, ['roll_number', 'nonce', 'resume']);
  const existing = credential(req);
  if (req.body.resume === true) {
    if (!existing) return send(res, 200, { no_session: true });
    try { return send(res, 200, await rpc(db, 'mm_state', { p_token_hash: hash(existing) })); }
    catch (error) { if (error.message === 'INVALID_SESSION') return send(res, 200, { no_session: true }); throw error; }
  }
  const roll = normalizeRoll(req.body.roll_number);
  if (typeof req.body.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.nonce)) throw new Error('INVALID_REQUEST');
  let token = deriveCredential(roll, req.body.nonce);
  // A valid cookie can resume the same roll after refresh, but cannot claim
  // another roll's reservation. Never reset the stored start/deadline.
  if (existing) {
    try { const session = await rpc(db, 'mm_state', { p_token_hash: hash(existing) }); if (session.roll_number === roll) token = existing; }
    catch (error) { if (error.message !== 'INVALID_SESSION') throw error; }
  }
  const state = await rpc(db, 'mm_start', { p_roll: roll, p_token_hash: hash(token) });
  res.setHeader('Set-Cookie', cookieHeader(token, req));
  return send(res, 200, state);
});
