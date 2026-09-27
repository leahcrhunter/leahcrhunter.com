-- Kitchen app schema. Quantities in pantry_items, usage_log and shopping_list
-- are always in a base unit: 'g', 'ml' or 'count'. Recipe lines keep the unit
-- they were written in ('cup', 'tbsp', 'clove', ...) and are converted on the fly.
-- Dates are local 'YYYY-MM-DD' strings sent by the phone, not UTC.

-- rev goes up by one on every write, so phones can poll cheaply for changes.
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO meta (key, value) VALUES ('rev', 0);

-- The shared vocabulary every tab matches on.
CREATE TABLE ingredients (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  aliases      TEXT NOT NULL DEFAULT '',          -- comma-separated: 'zucchini, baby courgette'
  category     TEXT NOT NULL DEFAULT 'other',
  default_unit TEXT NOT NULL DEFAULT 'g' CHECK (default_unit IN ('g', 'ml', 'count')),
  aisle        TEXT NOT NULL DEFAULT 'other',
  storage      TEXT NOT NULL DEFAULT 'cupboard',  -- where it goes when it comes home
  density      REAL,     -- grams per ml, for cups <-> grams (flour ~0.52)
  unit_weight  REAL,     -- grams per item, for '1 onion' <-> grams
  shelf_days   INTEGER,  -- default use-by, in days from purchase
  always_have  INTEGER NOT NULL DEFAULT 0  -- salt, oil, water: never 'missing'
);

CREATE TABLE pantry_items (
  id            INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity      REAL,    -- NULL means 'some'
  unit          TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'count')),
  location      TEXT NOT NULL DEFAULT 'cupboard'
                CHECK (location IN ('fridge', 'freezer', 'cupboard', 'spice rack')),
  purchased     TEXT NOT NULL,
  expires       TEXT,
  opened        TEXT,
  added_by      TEXT,
  notes         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX pantry_by_ingredient ON pantry_items (ingredient_id);

CREATE TABLE recipes (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  source_url   TEXT,
  photo_url    TEXT,
  servings     INTEGER NOT NULL DEFAULT 2,
  prep_min     INTEGER,
  cook_min     INTEGER,
  steps        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  notes        TEXT NOT NULL DEFAULT '',
  times_cooked INTEGER NOT NULL DEFAULT 0,
  last_cooked  TEXT,
  created      TEXT NOT NULL
);

CREATE TABLE recipe_ingredients (
  id            INTEGER PRIMARY KEY,
  recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  ingredient_id INTEGER REFERENCES ingredients(id),
  quantity      REAL,
  unit          TEXT,
  optional      INTEGER NOT NULL DEFAULT 0,
  original      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX recipe_lines ON recipe_ingredients (recipe_id, position);

-- The plan's 'each person's rating': one row per recipe per person.
CREATE TABLE recipe_ratings (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  person    TEXT NOT NULL,
  rating    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  PRIMARY KEY (recipe_id, person)
);

-- Every time food leaves the pantry. This is what next week's list is built from.
CREATE TABLE usage_log (
  id            INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity      REAL,
  unit          TEXT,
  date          TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('used', 'cooked', 'used up', 'thrown away')),
  recipe_id     INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  person        TEXT
);
CREATE INDEX usage_by_date ON usage_log (date);

-- Phase 5 (planner) tables, created now so the schema matches the plan.
CREATE TABLE staples (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id),
  min_quantity  REAL NOT NULL,
  unit          TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'count'))
);

CREATE TABLE meal_plan (
  id        INTEGER PRIMARY KEY,
  date      TEXT NOT NULL,
  meal      TEXT NOT NULL DEFAULT 'dinner',
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  servings  INTEGER,
  note      TEXT  -- 'leftovers', 'eating out'
);

CREATE TABLE shopping_list (
  id             INTEGER PRIMARY KEY,
  ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
  quantity       REAL,
  unit           TEXT CHECK (unit IN ('g', 'ml', 'count')),
  reason         TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN ('restock', 'recipe', 'manual')),
  label          TEXT NOT NULL DEFAULT '',  -- 'added by Leah', 'for Tuesday''s curry'
  ticked         INTEGER NOT NULL DEFAULT 0,
  -- the pantry batch that ticking created, so un-ticking a mis-tap takes it back out
  pantry_item_id INTEGER REFERENCES pantry_items(id) ON DELETE SET NULL,
  added_by       TEXT
);

CREATE TABLE login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX login_attempts_at ON login_attempts (at);
