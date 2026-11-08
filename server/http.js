import { createHash, createHmac } from 'node:crypto';
import { getDatabase } from './db.js';
export const COOKIE = 'mm_session';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function credential(req) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export function deriveCredential(roll, nonce) {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SERVER_CONFIGURATION');
  // A 256-bit browser nonce makes start retries idempotent even if its response is
  // lost. The actual session credential is derived only on the server.
  return createHmac('sha256', key).update(`mind-machine:v1:${roll}:${nonce}`).digest('hex');
}
export function cookieHeader(token, req) {
  const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=172800${secure ? '; Secure' : ''}`;
}
export function normalizeRoll(value) {
  if (typeof value !== 'string') throw new Error('INVALID_ROLL');
  const input = value.trim();
  if (!/^[a-z0-9][a-z0-9 -]{2,19}$/i.test(input)) throw new Error('INVALID_ROLL');
  const normalized = input.replace(/[ -]/g, '').toUpperCase();
  if (normalized.length < 3) throw new Error('INVALID_ROLL');
  return normalized;
}
const known = {
  INVALID_ROLL: [400, 'Enter a valid university roll number.'],
  INVALID_REQUEST: [400, 'The request is invalid. Refresh and try again.'],
  ALREADY_USED: [409, 'This roll number has already reserved its one attempt.'],
  INVALID_SESSION: [401, 'No matching game session was found on this browser.'],
  OUT_OF_ORDER: [409, 'This question is no longer active. Resume your game.'],
  ANSWER_CONFLICT: [409, 'An answer for this question has already been recorded.'],
  TOO_EARLY: [409, 'The game is still active. Continue until completion or timeout.'],
  QUESTION_BANK_NOT_READY: [503, 'The game has not been configured yet. Please try later.'],
  RANDOMIZATION_NOT_READY: [503, 'The database needs the random-order update. Run 005_randomization_readiness.sql in Supabase, then redeploy Vercel. No new attempt was started.'],
  SERVER_CONFIGURATION: [503, 'The game server is not configured yet. Please try later.']
};
export function send(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(data);
}
export function endpoint(method, callback, dbProvider = getDatabase) {
  return async (req, res) => {
    if (req.method !== method) { res.setHeader('Allow', method); return send(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }); }
    try {
      if (method === 'POST') {
        const origin = req.headers.origin;
        if (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch (_) { return true; } })()) return send(res, 403, { error: 'ORIGIN_REJECTED', message: 'Use this game from its own website.' });
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('INVALID_REQUEST');
        if (Number(req.headers['content-length'] || 0) > 4096) throw new Error('INVALID_REQUEST');
        if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch (_) { throw new Error('INVALID_REQUEST'); } }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || JSON.stringify(req.body).length > 4096) throw new Error('INVALID_REQUEST');
      }
      return await callback(req, res, dbProvider());
    } catch (error) {
      const code = Object.keys(known).find(code => error.message === code);
      const [status, message] = code ? known[code] : [503, 'The server could not complete this request. Please retry.'];
      return send(res, status, { error: code || 'SERVICE_UNAVAILABLE', message });
    }
  };
}
export async function rpc(db, name, parameters = {}) {
  const { data, error } = await db.rpc(name, parameters);
  if (error && ['mm_start_randomized', 'mm_state_randomized'].includes(name) && ['PGRST202', '42883'].includes(error.code)) throw new Error('RANDOMIZATION_NOT_READY');
  if (error) throw new Error(Object.keys(known).find(code => error.message === code) || 'SERVICE_UNAVAILABLE');
  return data;
}
export function requireCredential(req) {
  const token = credential(req);
  if (!token) throw new Error('INVALID_SESSION');
  return hash(token);
}
export function fields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('INVALID_REQUEST');
}
