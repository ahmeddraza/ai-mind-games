import { endpoint, send, rpc, requireCredential, fields } from '../server/http.js';
export default endpoint('POST', async (req, res, db) => {
  fields(req.body, []);
  return send(res, 200, await rpc(db, 'mm_finish', { p_token_hash: requireCredential(req) }));
});
