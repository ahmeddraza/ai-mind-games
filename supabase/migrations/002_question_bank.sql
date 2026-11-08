-- Private answer key. Never copy this file into static output.
begin;
insert into mind_games_private.questions(id,round_number,round_question,data) values
(1,1,1,'{"image":"ai-personality/batman.jpeg","title":"Who am I?","clue":"I have no superpowers, but fear is my greatest weapon.","options":["Batman","Iron Man","Black Panther","Daredevil"],"answer":0}'::jsonb),
(2,1,2,'{"image":"ai-personality/nikola-tesla.jpeg","title":"Who am I?","clue":"I helped shape the electrical systems powering our world.","options":["Thomas Edison","Isaac Newton","Nikola Tesla","Albert Einstein"],"answer":2}'::jsonb),
(3,1,3,'{"image":"ai-personality/sherlock-homes.jpeg","title":"Who am I?","clue":"I notice the smallest details to solve the biggest mysteries.","options":["Hercule Poirot","Sherlock Holmes","James Bond","Benoit Blanc"],"answer":1}'::jsonb),
(4,1,4,'{"image":"ai-personality/harry-porter.jpeg","title":"Who am I?","clue":"A mysterious letter introduced me to a world I never knew existed.","options":["Percy Jackson","Newt Scamander","Frodo Baggins","Harry Potter"],"answer":3}'::jsonb),
(5,1,5,'{"image":"ai-personality/walter-white.jpeg","title":"Who am I?","clue":"My knowledge of chemistry took me down a dangerous path.","options":["Walter White","Gus Fring","Jesse Pinkman","Saul Goodman"],"answer":0}'::jsonb),
(6,1,6,'{"image":"ai-personality/einstein.jpeg","title":"Who am I?","clue":"I changed the way humanity understands space and time.","options":["Isaac Newton","Stephen Hawking","Albert Einstein","Nikola Tesla"],"answer":2}'::jsonb),
(7,1,7,'{"image":"ai-personality/spiderman.jpeg","title":"Who am I?","clue":"An unexpected bite gave me a new way to get around the city.","options":["Ant-Man","Spider-Man","The Flash","Deadpool"],"answer":1}'::jsonb),
(8,1,8,'{"image":"ai-personality/jack-sparrow.jpeg","title":"Who am I?","clue":"My unusual compass points toward what I want most.","options":["Captain Hook","Long John Silver","Hector Barbossa","Jack Sparrow"],"answer":3}'::jsonb),
(9,1,9,'{"image":"ai-personality/elsa.jpeg","title":"Who am I?","clue":"Learning to control my powers changed the fate of a frozen kingdom.","options":["Elsa","Anna","Rapunzel","Merida"],"answer":0}'::jsonb),
(10,1,10,'{"image":"ai-personality/Morpheus.jpeg","title":"Who am I?","clue":"I offer a choice between a comforting illusion and a difficult truth.","options":["Neo","Agent Smith","Morpheus","The Oracle"],"answer":2}'::jsonb),
(11,2,1,'{"image":"ai-vs-human/ai_image.png","title":"Is this a real photograph or AI-generated?","clue":"Examine the abstract artwork and its details.","options":["REAL PHOTO","AI GENERATED"],"answer":1,"labelSource":"Supplied filename: ai_image.png"}'::jsonb),
(12,2,2,'{"image":"ai-vs-human/real2_image.jpg","title":"Is this a real photograph or AI-generated?","clue":"Look closely at this scene beside a window.","options":["REAL PHOTO","AI GENERATED"],"answer":0,"labelSource":"Supplied filename: real2_image.jpg"}'::jsonb),
(13,2,3,'{"image":"ai-vs-human/ai2_image.png","title":"Is this a real photograph or AI-generated?","clue":"Study the details of this food image.","options":["REAL PHOTO","AI GENERATED"],"answer":1,"labelSource":"Supplied filename: ai2_image.png"}'::jsonb),
(14,2,4,'{"image":"ai-vs-human/real_image.jpg","title":"Is this a real photograph or AI-generated?","clue":"Inspect the portrait and its textures.","options":["REAL PHOTO","AI GENERATED"],"answer":0,"labelSource":"Supplied filename and user confirmation: human-made portrait artwork"}'::jsonb),
(15,2,5,'{"image":"ai-vs-human/ai3_image.png","title":"Is this a real photograph or AI-generated?","clue":"Examine the materials and details of the shoes.","options":["REAL PHOTO","AI GENERATED"],"answer":1,"labelSource":"Supplied filename: ai3_image.png"}'::jsonb)
on conflict(id) do update set round_number=excluded.round_number,round_question=excluded.round_question,data=excluded.data;
commit;
