-- Supabase: enable pg_cron in Database > Extensions, then run this file.
-- Required for automatic finalization even if all browsers close. Public GET
-- /api/leaderboard and credentialed state requests also finalize overdue attempts.
create extension if not exists pg_cron;
do $$ begin
  if not exists(select 1 from cron.job where jobname='mind-machine-expiry') then
    perform cron.schedule('mind-machine-expiry','* * * * *','select mind_games_private.finalize_expired();');
  end if;
end; $$;
