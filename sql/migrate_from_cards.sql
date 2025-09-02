-- Migrate existing simple cards(front/back,user_id) into vocab_items + user_cards
-- Assumptions: existing table cards(id SERIAL, user_id INTEGER, front TEXT, back TEXT [, status, know_count, next_due])

-- Create L2 vocab from unique fronts
WITH src AS (
  SELECT DISTINCT front, back FROM cards WHERE front IS NOT NULL AND back IS NOT NULL
)
INSERT INTO vocab_items(text, lang_code)
SELECT s.front, 'en' FROM src s
ON CONFLICT (lang_code, text) DO NOTHING;

-- Ensure RU translations for each vocab
INSERT INTO vocab_translations(vocab_id, lang_code, meaning)
SELECT v.id, 'ru', s.back
FROM (SELECT DISTINCT front, back FROM cards WHERE front IS NOT NULL AND back IS NOT NULL) s
JOIN vocab_items v ON v.text = s.front AND v.lang_code = 'en'
ON CONFLICT DO NOTHING;

-- Attach user_cards
INSERT INTO user_cards(user_id, vocab_id, card_type, state, reps, due)
SELECT c.user_id,
       v.id,
       'L2_TO_L1'::card_type,
       CASE
         WHEN c.status = 'learn'   THEN 'learning'
         WHEN c.status = 'know'    THEN 'review'
         WHEN c.status = 'learned' THEN 'review'
         ELSE 'new'
       END::card_state,
       COALESCE(c.know_count, 0),
       CASE WHEN c.next_due IS NOT NULL THEN c.next_due END
FROM cards c
JOIN vocab_items v ON v.text = c.front AND v.lang_code = 'en'
ON CONFLICT DO NOTHING;


