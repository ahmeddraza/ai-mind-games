-- Run in the Supabase SQL editor as postgres. Atomic; no existing rows are deleted.
begin;

create schema if not exists mind_games_private;
revoke all on schema mind_games_private from public, anon, authenticated;

create or replace function mind_games_private.normalize_roll(value text)
returns text language plpgsql immutable set search_path = '' as $$
declare normalized text;
begin
  if value is null or btrim(value) !~ '^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$' then raise exception 'INVALID_ROLL'; end if;
  normalized := regexp_replace(upper(btrim(value)), '[ -]', '', 'g');
  if length(normalized) < 3 then raise exception 'INVALID_ROLL'; end if;
  return normalized;
end; $$;

create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  roll_number text not null,
  score integer not null,
  correct_answers integer not null,
  created_at timestamptz not null default clock_timestamp()
);
-- Existing tables retain their ID type/default. Expected columns must exist.
-- Abort instead of silently discarding, clamping, or merging legacy data.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='leaderboard' and column_name='id' and column_default is null and is_identity='NO') then
    raise exception 'leaderboard.id needs an identity/default generator before this migration can be used.';
  end if;
  if exists (select 1 from public.leaderboard where score is null or correct_answers is null or created_at is null or score < 0 or score > 1500 or correct_answers < 0 or correct_answers > 15 or score <> correct_answers * 100) then
    raise exception 'Existing leaderboard rows violate the new scoring rules. Review/archive them before retrying; no rows were changed.';
  end if;
  if exists (select 1 from public.leaderboard group by mind_games_private.normalize_roll(roll_number) having count(*) > 1) then
    raise exception 'Existing leaderboard contains duplicate normalized rolls. Review duplicates before retrying; no rows were changed.';
  end if;
end; $$;
update public.leaderboard set roll_number = mind_games_private.normalize_roll(roll_number);
alter table public.leaderboard alter column roll_number set not null, alter column score set not null, alter column correct_answers set not null, alter column created_at set not null;
alter table public.leaderboard drop constraint if exists mm_score_range;
alter table public.leaderboard add constraint mm_score_range check (score between 0 and 1500 and correct_answers between 0 and 15 and score = correct_answers * 100);
alter table public.leaderboard drop constraint if exists mm_roll_canonical;
alter table public.leaderboard add constraint mm_roll_canonical check (roll_number = mind_games_private.normalize_roll(roll_number));
create unique index if not exists mm_leaderboard_roll_unique on public.leaderboard(roll_number);
create index if not exists mm_leaderboard_order on public.leaderboard(score desc, created_at asc, id asc);
create or replace function mind_games_private.canonicalize_roll()
returns trigger language plpgsql set search_path = '' as $$
begin new.roll_number := mind_games_private.normalize_roll(new.roll_number); return new; end; $$;
drop trigger if exists mm_roll_normalization on public.leaderboard;
create trigger mm_roll_normalization before insert or update of roll_number on public.leaderboard for each row execute function mind_games_private.canonicalize_roll();

alter table public.leaderboard enable row level security;
-- Remove existing permissive policies as well as public grants.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leaderboard' loop
    execute format('drop policy %I on public.leaderboard', p.policyname);
  end loop;
end; $$;
revoke all on public.leaderboard from public, anon, authenticated;

create table if not exists mind_games_private.questions (
  id smallint primary key check (id between 1 and 15),
  round_number smallint not null check (round_number in (1,2)),
  round_question smallint not null,
  data jsonb not null,
  unique(round_number, round_question)
);
create table if not exists mind_games_private.attempts (
  roll_number text primary key,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  snapshot jsonb not null check (jsonb_array_length(snapshot) = 15),
  finished_at timestamptz,
  leaderboard_id text,
  time_remaining integer check (time_remaining between 0 and 60),
  check (expires_at = started_at + interval '60 seconds')
);
create index if not exists mm_expiring_attempts on mind_games_private.attempts(expires_at) where finished_at is null;
create table if not exists mind_games_private.answers (
  roll_number text references mind_games_private.attempts(roll_number),
  question_id smallint check (question_id between 1 and 15),
  option_id uuid not null,
  correct boolean not null,
  accepted_at timestamptz not null,
  primary key(roll_number, question_id)
);
alter table mind_games_private.questions enable row level security;
alter table mind_games_private.attempts enable row level security;
alter table mind_games_private.answers enable row level security;
revoke all on all tables in schema mind_games_private from public, anon, authenticated;

create or replace function mind_games_private.finalize(p_roll text)
returns void language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype; n integer; c integer; result_id text; finished timestamptz;
begin
  select * into a from mind_games_private.attempts where roll_number = p_roll for update;
  if not found then raise exception 'INVALID_SESSION'; end if;
  if a.finished_at is not null then return; end if;
  select count(*), count(*) filter (where correct) into n,c from mind_games_private.answers where roll_number = p_roll;
  finished := clock_timestamp();
  if n < 15 and finished < a.expires_at then raise exception 'TOO_EARLY'; end if;
  insert into public.leaderboard(roll_number,score,correct_answers,created_at)
    values(p_roll,c*100,c,finished) returning id::text into result_id;
  update mind_games_private.attempts set finished_at=finished,leaderboard_id=result_id,
    time_remaining=greatest(0,least(60,ceil(extract(epoch from (a.expires_at-finished)))::integer)) where roll_number=p_roll;
end; $$;

create or replace function mind_games_private.public_state(p_roll text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype; n integer; c integer; result jsonb; place bigint; entry public.leaderboard%rowtype;
begin
  select * into a from mind_games_private.attempts where roll_number=p_roll;
  select count(*), count(*) filter(where correct) into n,c from mind_games_private.answers where roll_number=p_roll;
  result := jsonb_build_object('roll_number',a.roll_number,'server_now',floor(extract(epoch from clock_timestamp())*1000),
    'deadline',floor(extract(epoch from a.expires_at)*1000),'answered',n,'correct_answers',c,'score',c*100,
    'finished',a.finished_at is not null,'question',case when a.finished_at is null and n<15 then (a.snapshot->n)-'correct_option' else null end);
  if a.finished_at is not null then
    select * into entry from public.leaderboard where id::text=a.leaderboard_id;
    select count(*)+1 into place from public.leaderboard where score>entry.score or
      (score=entry.score and (created_at,id::text)<(entry.created_at,entry.id::text));
    result := result || jsonb_build_object('result',jsonb_build_object('id',entry.id::text,'roll_number',a.roll_number,
      'score',entry.score,'correct_answers',c,'incorrect_answers',n-c,'unanswered_questions',15-n,'answered',n,'total',15,
      'accuracy',case when n=0 then 0 else round(c*100.0/n) end,'time_remaining',a.time_remaining,'rank',place,'created_at',entry.created_at));
  end if;
  return result;
end; $$;

create or replace function public.mm_start(p_roll text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare roll text; a mind_games_private.attempts%rowtype; q record; options jsonb; safe_options jsonb; correct_id text; snapshot jsonb := '[]'; began timestamptz;
begin
  roll := mind_games_private.normalize_roll(p_roll);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  select * into a from mind_games_private.attempts where roll_number=roll for update;
  if not found then
    if exists(select 1 from public.leaderboard where roll_number=roll) then raise exception 'ALREADY_USED'; end if;
    if (select count(*) from mind_games_private.questions)<>15 or (select count(*) from mind_games_private.questions where round_number=1)<>10 then raise exception 'QUESTION_BANK_NOT_READY'; end if;
    for q in select * from mind_games_private.questions order by id loop
      select jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'text',value,'index',ordinality-1) order by random())
        into options from jsonb_array_elements_text(q.data->'options') with ordinality;
      select value->>'id' into correct_id from jsonb_array_elements(options) where (value->>'index')::integer=(q.data->>'answer')::integer;
      select jsonb_agg(value-'index') into safe_options from jsonb_array_elements(options);
      snapshot := snapshot || jsonb_build_array(jsonb_build_object('id',q.id,'round',q.round_number,'round_question',q.round_question,
        'round_count',case when q.round_number=1 then 10 else 5 end,'image',q.data->>'image','title',q.data->>'title','clue',q.data->>'clue',
        'options',safe_options,'correct_option',correct_id));
    end loop;
    began := clock_timestamp();
    insert into mind_games_private.attempts(roll_number,token_hash,started_at,expires_at,snapshot)
      values(roll,p_token_hash,began,began+interval '60 seconds',snapshot) on conflict(roll_number) do nothing;
    select * into a from mind_games_private.attempts where roll_number=roll for update;
  end if;
  if a.token_hash<>p_token_hash then raise exception 'ALREADY_USED'; end if;
  if a.finished_at is null and clock_timestamp()>=a.expires_at then perform mind_games_private.finalize(roll); end if;
  return mind_games_private.public_state(roll);
end; $$;

create or replace function public.mm_state(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype;
begin
  select * into a from mind_games_private.attempts where token_hash=p_token_hash for update;
  if not found then raise exception 'INVALID_SESSION'; end if;
  if a.finished_at is null and clock_timestamp()>=a.expires_at then perform mind_games_private.finalize(a.roll_number); end if;
  return mind_games_private.public_state(a.roll_number);
end; $$;

create or replace function public.mm_answer(p_token_hash text,p_question integer,p_option uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype; previous mind_games_private.answers%rowtype; n integer; q jsonb; correct boolean; received timestamptz;
begin
  -- All mutations for a session lock the same row. clock_timestamp is checked
  -- AFTER acquiring it, so requests queued beyond expiry cannot add answers.
  select * into a from mind_games_private.attempts where token_hash=p_token_hash for update;
  if not found then raise exception 'INVALID_SESSION'; end if;
  if a.finished_at is null and clock_timestamp()>=a.expires_at then perform mind_games_private.finalize(a.roll_number); end if;
  select * into previous from mind_games_private.answers where roll_number=a.roll_number and question_id=p_question;
  if found then
    if previous.option_id<>p_option then raise exception 'ANSWER_CONFLICT'; end if;
    return mind_games_private.public_state(a.roll_number)||jsonb_build_object('feedback',jsonb_build_object('question_id',p_question,'correct',previous.correct));
  end if;
  if exists(select 1 from mind_games_private.attempts where roll_number=a.roll_number and finished_at is not null) then return mind_games_private.public_state(a.roll_number); end if;
  select count(*) into n from mind_games_private.answers where roll_number=a.roll_number;
  if p_question is null or p_question<>n+1 then raise exception 'OUT_OF_ORDER'; end if;
  q := a.snapshot->n;
  if p_option is null or not exists(select 1 from jsonb_array_elements(q->'options') where value->>'id'=p_option::text) then raise exception 'INVALID_REQUEST'; end if;
  correct := q->>'correct_option'=p_option::text;
  received := clock_timestamp();
  if received>=a.expires_at then
    perform mind_games_private.finalize(a.roll_number);
    return mind_games_private.public_state(a.roll_number);
  end if;
  insert into mind_games_private.answers values(a.roll_number,p_question,p_option,correct,received);
  if n+1=15 then perform mind_games_private.finalize(a.roll_number); end if;
  return mind_games_private.public_state(a.roll_number)||jsonb_build_object('feedback',jsonb_build_object('question_id',p_question,'correct',correct));
end; $$;

create or replace function public.mm_finish(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype;
begin
  select * into a from mind_games_private.attempts where token_hash=p_token_hash for update;
  if not found then raise exception 'INVALID_SESSION'; end if;
  perform mind_games_private.finalize(a.roll_number);
  return mind_games_private.public_state(a.roll_number);
end; $$;

create or replace function mind_games_private.finalize_expired()
returns integer language plpgsql security definer set search_path = '' as $$
declare a record; n integer := 0;
begin
  for a in select roll_number from mind_games_private.attempts where finished_at is null and expires_at<=clock_timestamp()
    order by expires_at limit 100 for update skip locked loop
    perform mind_games_private.finalize(a.roll_number); n:=n+1;
  end loop;
  return n;
end; $$;

create or replace function public.mm_leaderboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform mind_games_private.finalize_expired();
  select coalesce(jsonb_agg(row),'[]'::jsonb) into result from
    (select row_number() over(order by score desc,created_at asc,id::text asc) as rank,
      id::text,roll_number,score,correct_answers,created_at from public.leaderboard
      order by score desc,created_at asc,id::text asc limit 10) row;
  return result;
end; $$;

revoke all on all functions in schema mind_games_private from public, anon, authenticated;
revoke all on function public.mm_start(text,text),public.mm_state(text),public.mm_answer(text,integer,uuid),public.mm_finish(text),public.mm_leaderboard() from public,anon,authenticated;
grant execute on function public.mm_start(text,text),public.mm_state(text),public.mm_answer(text,integer,uuid),public.mm_finish(text),public.mm_leaderboard() to service_role;
commit;
