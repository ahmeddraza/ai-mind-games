import { createClient } from '@supabase/supabase-js';
let client;
export function getDatabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('sb_publishable_') || !/^https:\/\//.test(url)) throw new Error('SERVER_CONFIGURATION');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}
