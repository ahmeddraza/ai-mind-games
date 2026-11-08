import { endpoint, send, rpc, requireCredential, fields } from '../server/http.js';
export default endpoint('POST', async (req, res, db) => {
  fields(req.body, ['question_id', 'option_id']);
  if (!Number.isInteger(req.body.question_id) || req.body.question_id < 1 || req.body.question_id > 15 || typeof req.body.option_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(req.body.option_id)) throw new Error('INVALID_REQUEST');
  return send(res, 200, await rpc(db, 'mm_answer', { p_token_hash: requireCredential(req), p_question: req.body.question_id, p_option: req.body.option_id }));
});
