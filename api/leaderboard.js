import { endpoint, send, rpc } from '../server/http.js';
export default endpoint('GET', async (_req, res, db) => send(res, 200, { rows: await rpc(db, 'mm_leaderboard') }));
