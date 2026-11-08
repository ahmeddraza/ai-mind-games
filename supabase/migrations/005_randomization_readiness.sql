-- Self-contained repair: apply after 001/002; 004 may be installed or missing.
-- Includes the secure shuffle definitions so only this new file needs to run.
-- Existing 001-004 migration files must not be edited or rerun.
-- No table rows, question content, previous migrations, scores or snapshots are
-- updated/deleted. Only NEW reservations receive newly randomized snapshots.
begin;

create or replace function mind_games_private.secure_random_below(p_bound integer)
returns integer language plpgsql volatile set search_path = '' as $$
declare sample bigint; cutoff bigint;
begin
  if p_bound is null or p_bound < 1 or p_bound > 32767 then raise exception 'INVALID_REQUEST'; end if;
  -- gen_random_uuid() uses PostgreSQL's strong random generator. The first
  -- eight hex digits contain 32 random bits, before the fixed version/variant
  -- bits. Rejection sampling eliminates modulo bias for every bound.
  -- Source: https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/uuid.c
  cutoff := 4294967296::bigint - (4294967296::bigint % p_bound);
  loop
    sample := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
    if sample < cutoff then return (sample % p_bound)::integer; end if;
  end loop;
end; $$;

create or replace function mind_games_private.secure_shuffle(p_values jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare result jsonb := p_values; n integer; i integer; j integer; saved jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'array' then raise exception 'INVALID_REQUEST'; end if;
  n := jsonb_array_length(p_values);
  if n > 32767 then raise exception 'INVALID_REQUEST'; end if;
  if n < 2 then return result; end if;
  -- Fisher-Yates: choose uniformly from [0, i], then swap in place.
  for i in reverse (n - 1)..1 loop
    j := mind_games_private.secure_random_below(i + 1);
    saved := result->i;
    result := jsonb_set(result, array[i::text], result->j, false);
    result := jsonb_set(result, array[j::text], saved, false);
  end loop;
  return result;
end; $$;

create or replace function public.mm_start(p_roll text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare roll text; a mind_games_private.attempts%rowtype; q record; options jsonb; safe_options jsonb;
  correct_id text; snapshot jsonb := '[]'; first_round jsonb; second_round jsonb; began timestamptz; i integer;
begin
  roll := mind_games_private.normalize_roll(p_roll);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  select * into a from mind_games_private.attempts where roll_number=roll for update;
  if not found then
    if exists(select 1 from public.leaderboard where roll_number=roll) then raise exception 'ALREADY_USED'; end if;
    if (select count(*) from mind_games_private.questions)<>15
      or (select count(*) from mind_games_private.questions where round_number=1)<>10
      or (select count(*) from mind_games_private.questions where round_number=2)<>5 then
      raise exception 'QUESTION_BANK_NOT_READY';
    end if;
    for q in select * from mind_games_private.questions order by round_number,id loop
      if jsonb_typeof(q.data->'options') is distinct from 'array' then raise exception 'QUESTION_BANK_NOT_READY'; end if;
      if jsonb_array_length(q.data->'options') <> (case when q.round_number=1 then 4 else 2 end)
        or (q.data->>'answer')::integer is null
        or (q.data->>'answer')::integer not between 0 and jsonb_array_length(q.data->'options')-1 then
        raise exception 'QUESTION_BANK_NOT_READY';
      end if;
      select jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'text',value,'index',ordinality-1) order by ordinality)
        into options from jsonb_array_elements_text(q.data->'options') with ordinality;
      options := mind_games_private.secure_shuffle(options);
      select value->>'id' into correct_id from jsonb_array_elements(options)
        where (value->>'index')::integer=(q.data->>'answer')::integer;
      select jsonb_agg(value-'index' order by ordinality) into safe_options
        from jsonb_array_elements(options) with ordinality;
      snapshot := snapshot || jsonb_build_array(jsonb_build_object('id',q.id,'round',q.round_number,
        'round_question',q.round_question,'round_count',case when q.round_number=1 then 10 else 5 end,
        'image',q.data->>'image','title',q.data->>'title','clue',q.data->>'clue',
        'options',safe_options,'correct_option',correct_id));
    end loop;
    select jsonb_agg(value order by ordinality) into first_round
      from jsonb_array_elements(snapshot) with ordinality where (value->>'round')::integer=1;
    select jsonb_agg(value order by ordinality) into second_round
      from jsonb_array_elements(snapshot) with ordinality where (value->>'round')::integer=2;
    snapshot := mind_games_private.secure_shuffle(first_round) || mind_games_private.secure_shuffle(second_round);
    for i in 0..14 loop
      -- Stable ID stays attached to the original question. These fields are
      -- presentation positions within the session, never scoring identifiers.
      snapshot := jsonb_set(snapshot, array[i::text,'position'], to_jsonb(i+1));
      snapshot := jsonb_set(snapshot, array[i::text,'round_question'], to_jsonb(case when i<10 then i+1 else i-9 end));
    end loop;
    began := clock_timestamp();
    insert into mind_games_private.attempts(roll_number,token_hash,started_at,expires_at,snapshot)
      values(roll,p_token_hash,began,began+interval '60 seconds',snapshot) on conflict(roll_number) do nothing;
    -- A concurrent loser uses the winning persisted snapshot, never its own
    -- newly generated order. An existing session never enters this branch.
    select * into a from mind_games_private.attempts where roll_number=roll for update;
  end if;
  if a.token_hash<>p_token_hash then raise exception 'ALREADY_USED'; end if;
  if a.finished_at is null and clock_timestamp()>=a.expires_at then perform mind_games_private.finalize(roll); end if;
  return mind_games_private.public_state(roll);
end; $$;

create or replace function mind_games_private.public_state(p_roll text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype; n integer; c integer; result jsonb; place bigint;
  entry public.leaderboard%rowtype; assigned_order jsonb; active_question jsonb;
begin
  select * into a from mind_games_private.attempts where roll_number=p_roll;
  select count(*), count(*) filter(where correct) into n,c from mind_games_private.answers where roll_number=p_roll;
  select jsonb_agg((value->>'id')::integer order by ordinality) into assigned_order
    from jsonb_array_elements(a.snapshot) with ordinality;
  if a.finished_at is null and n<15 then
    -- position is also supplied for pre-migration snapshots without changing
    -- the stored snapshot or any existing question/option IDs.
    active_question := ((a.snapshot->n)-'correct_option') || jsonb_build_object('position',n+1);
  end if;
  result := jsonb_build_object('roll_number',a.roll_number,'server_now',floor(extract(epoch from clock_timestamp())*1000),
    'deadline',floor(extract(epoch from a.expires_at)*1000),'answered',n,'correct_answers',c,'score',c*100,
    'finished',a.finished_at is not null,'question_order',assigned_order,'question',active_question);
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

create or replace function public.mm_answer(p_token_hash text,p_question integer,p_option uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a mind_games_private.attempts%rowtype; previous mind_games_private.answers%rowtype;
  n integer; q jsonb; correct boolean; received timestamptz;
begin
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
  q := a.snapshot->n;
  if p_question is null or p_question<>(q->>'id')::integer then raise exception 'OUT_OF_ORDER'; end if;
  if p_option is null or not exists(select 1 from jsonb_array_elements(q->'options') where value->>'id'=p_option::text) then raise exception 'INVALID_REQUEST'; end if;
  correct := q->>'correct_option'=p_option::text;
  received := clock_timestamp();
  if received>=a.expires_at then
    perform mind_games_private.finalize(a.roll_number);
    return mind_games_private.public_state(a.roll_number);
  end if;
  -- Persist the stable question ID, not the shuffled array position.
  insert into mind_games_private.answers values(a.roll_number,p_question,p_option,correct,received);
  if n+1=15 then perform mind_games_private.finalize(a.roll_number); end if;
  return mind_games_private.public_state(a.roll_number)||jsonb_build_object('feedback',jsonb_build_object('question_id',p_question,'correct',correct));
end; $$;

revoke all on function mind_games_private.secure_random_below(integer),mind_games_private.secure_shuffle(jsonb),mind_games_private.public_state(text) from public,anon,authenticated;
revoke all on function public.mm_start(text,text),public.mm_answer(text,integer,uuid) from public,anon,authenticated;
grant execute on function public.mm_start(text,text),public.mm_answer(text,integer,uuid) to service_role;

-- Versioned, transactional API contract: an old function can never silently
-- reserve a new fixed-order attempt. A failed readiness check rolls it back.
create or replace function mind_games_private.randomized_client_state(p_state jsonb,p_resumed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare assigned boolean;
begin
  if jsonb_typeof(p_state->'question_order') is distinct from 'array' then raise exception 'RANDOMIZATION_NOT_READY'; end if;
  if jsonb_array_length(p_state->'question_order')<>15 then raise exception 'RANDOMIZATION_NOT_READY'; end if;
  select (snapshot->0) ? 'position' into assigned from mind_games_private.attempts where roll_number=p_state->>'roll_number';
  if not p_resumed and not coalesce(assigned,false) then raise exception 'RANDOMIZATION_NOT_READY'; end if;
  return p_state || jsonb_build_object('randomization_version',2,'resumed',p_resumed,
    'order_type',case when assigned then 'randomized' else 'legacy' end);
end; $$;

create or replace function public.mm_start_randomized(p_roll text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing boolean; state jsonb;
begin
  select exists(select 1 from mind_games_private.attempts where roll_number=mind_games_private.normalize_roll(p_roll)) into existing;
  state := public.mm_start(p_roll,p_token_hash);
  return mind_games_private.randomized_client_state(state,existing);
end; $$;

create or replace function public.mm_state_randomized(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return mind_games_private.randomized_client_state(public.mm_state(p_token_hash),true);
end; $$;

revoke all on function mind_games_private.randomized_client_state(jsonb,boolean) from public,anon,authenticated;
revoke all on function public.mm_start_randomized(text,text),public.mm_state_randomized(text) from public,anon,authenticated;
grant execute on function public.mm_start_randomized(text,text),public.mm_state_randomized(text) to service_role;
notify pgrst, 'reload schema';
commit;
