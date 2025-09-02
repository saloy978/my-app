-- SRS core schema (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS unaccent;   -- normalized text

DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'card_type';
  IF NOT FOUND THEN
    CREATE TYPE card_type AS ENUM ('L1_TO_L2','L2_TO_L1','DICTATION','CHOICE');
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'card_state';
  IF NOT FOUND THEN
    CREATE TYPE card_state AS ENUM ('new','learning','review','relearning','suspended','buried');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vocab_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  normalized TEXT,
  lang_code TEXT NOT NULL REFERENCES languages(code),
  part_of_speech TEXT,
  is_phrase BOOLEAN DEFAULT FALSE,
  transcription TEXT,
  frequency_rank INTEGER,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lang_code, text)
);

-- Trigger to keep normalized = unaccent(lower(text))
CREATE OR REPLACE FUNCTION set_vocab_normalized()
RETURNS trigger AS $$
BEGIN
  NEW.normalized := unaccent(lower(NEW.text));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_vocab_normalized'
  ) THEN
    CREATE TRIGGER trg_set_vocab_normalized
    BEFORE INSERT OR UPDATE OF text ON vocab_items
    FOR EACH ROW EXECUTE FUNCTION set_vocab_normalized();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vocab_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocab_id UUID NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
  lang_code TEXT NOT NULL REFERENCES languages(code),
  meaning TEXT NOT NULL,
  alt_meanings TEXT[],
  note TEXT,
  CONSTRAINT uq_vocab_translation UNIQUE (vocab_id, lang_code, meaning)
);

CREATE TABLE IF NOT EXISTS vocab_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocab_id UUID NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
  src_text TEXT NOT NULL,
  translation TEXT,
  audio_url TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vocab_tags (
  vocab_id UUID NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (vocab_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_vocab_id UUID REFERENCES vocab_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS lesson_vocab (
  lesson_id UUID NOT NULL,
  vocab_id  UUID NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
  required  BOOLEAN NOT NULL DEFAULT TRUE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  position INTEGER,
  PRIMARY KEY (lesson_id, vocab_id)
);

-- NOTE: users.id is INTEGER in current app → use INTEGER here
CREATE TABLE IF NOT EXISTS user_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id UUID NOT NULL REFERENCES vocab_items(id) ON DELETE CASCADE,
  card_type card_type NOT NULL DEFAULT 'L2_TO_L1',
  state card_state NOT NULL DEFAULT 'new',
  ease NUMERIC(3,2) NOT NULL DEFAULT 2.50,
  ivl INTEGER NOT NULL DEFAULT 0,
  due TIMESTAMPTZ,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  buried_until TIMESTAMPTZ,
  leech BOOLEAN NOT NULL DEFAULT FALSE,
  note_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_card UNIQUE (user_id, vocab_id, card_type)
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_card_id UUID NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 3),
  taken_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'text',
  front_text TEXT,
  back_text TEXT,
  extra_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vocab_lang_norm   ON vocab_items(lang_code, normalized);
CREATE INDEX IF NOT EXISTS idx_vocab_text_fts    ON vocab_items USING GIN (to_tsvector('simple', text));
CREATE INDEX IF NOT EXISTS idx_user_cards_due    ON user_cards(user_id, due);
CREATE INDEX IF NOT EXISTS idx_user_cards_state  ON user_cards(user_id, state);
CREATE INDEX IF NOT EXISTS idx_reviews_card_ts   ON reviews(user_card_id, ts DESC);

-- Seed minimal languages
INSERT INTO languages(code, name) VALUES
  ('en','English'),
  ('ru','Russian'),
  ('es','Spanish'),
  ('de','German'),
  ('fr','French'),
  ('it','Italian'),
  ('pt','Portuguese')
ON CONFLICT (code) DO NOTHING;


