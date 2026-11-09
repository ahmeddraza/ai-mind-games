-- Update wording only. Existing attempts keep their saved question snapshots.
-- Run once in the existing Supabase project after migrations 001-005.
begin;
do $$
declare updated_count integer;
begin
  update mind_games_private.questions q
  set data = jsonb_set(q.data, '{clue}', revised.clue, false)
  from (values
      (1, 'ai-personality/batman.jpeg', '"I have no superpowers, but I protect Gotham at night.\nMy gadgets and detective skills help me fight crime."'::jsonb),
      (2, 'ai-personality/nikola-tesla.jpeg', '"I helped develop alternating-current power systems.\nMy experiments explored wireless energy and high voltage."'::jsonb),
      (3, 'ai-personality/sherlock-homes.jpeg', '"I solve mysteries by noticing what others miss.\nMy friend Dr. Watson records our cases in London."'::jsonb),
      (4, 'ai-personality/harry-porter.jpeg', '"A letter introduced me to a hidden world of magic.\nAt Hogwarts, I faced a dark wizard with my friends."'::jsonb),
      (5, 'ai-personality/walter-white.jpeg', '"I taught chemistry before entering a life of crime.\nI adopted the name Heisenberg to hide my identity."'::jsonb),
      (6, 'ai-personality/einstein.jpeg', '"I changed how we understand space and time.\nMy famous equation links energy with mass."'::jsonb),
      (7, 'ai-personality/spiderman.jpeg', '"A radioactive bite gave me extraordinary abilities.\nI swing through New York and climb walls."'::jsonb),
      (8, 'ai-personality/jack-sparrow.jpeg', '"I am a pirate whose compass follows my desires.\nI captain the Black Pearl with wit and a little luck."'::jsonb),
      (9, 'ai-personality/elsa.jpeg', '"My powers can turn the world around me into ice.\nI am a queen whose sister Anna helps me find courage."'::jsonb),
      (10, 'ai-personality/Morpheus.jpeg', '"I offer a choice between a red pill and a blue pill.\nI guide Neo toward the truth about the Matrix."'::jsonb)
  ) as revised(id, image, clue)
  where q.id = revised.id
    and q.round_number = 1
    and q.data->>'image' = revised.image;

  get diagnostics updated_count = row_count;
  if updated_count <> 10 then
    raise exception 'Expected the ten configured personality images. No clues were changed.';
  end if;
end;
$$;
commit;
