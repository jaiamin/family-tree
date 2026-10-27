PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  site TEXT CHECK (site IS NULL OR json_valid(site)),
  revision INTEGER NOT NULL DEFAULT 0,
  operation TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  sex TEXT CHECK (sex IS NULL OR sex IN ('male','female')),
  birth_date TEXT, death_date TEXT, birth_place TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS trees (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS parents (
  child_id TEXT NOT NULL REFERENCES people(id), parent_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY(child_id, parent_id), CHECK (child_id != parent_id)
);
CREATE INDEX IF NOT EXISTS parents_by_parent ON parents(parent_id);
CREATE TABLE IF NOT EXISTS partnerships (
  person_a TEXT NOT NULL REFERENCES people(id), person_b TEXT NOT NULL REFERENCES people(id),
  status TEXT CHECK (status IS NULL OR status IN ('married','partners','divorced')),
  marriage_date TEXT, marriage_place TEXT, divorce_date TEXT, has_details INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(person_a, person_b), CHECK (person_a < person_b)
);
CREATE INDEX IF NOT EXISTS partnerships_by_second_person ON partnerships(person_b);
CREATE TABLE IF NOT EXISTS tree_members (
  tree_id TEXT NOT NULL REFERENCES trees(id), person_id TEXT NOT NULL REFERENCES people(id),
  position INTEGER NOT NULL, PRIMARY KEY(tree_id, person_id)
);
CREATE INDEX IF NOT EXISTS memberships_by_person ON tree_members(person_id);
CREATE TABLE IF NOT EXISTS editors (email TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT,
  credential TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  person_name TEXT,
  sender_name TEXT NOT NULL,
  contact TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
  person_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_uploads (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS backup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL DEFAULT 0,
  saved_generation INTEGER NOT NULL DEFAULT 0, saved_at TEXT, error TEXT
);
INSERT OR IGNORE INTO backup_state(id) VALUES (1);
CREATE TRIGGER IF NOT EXISTS backup_collections_insert AFTER INSERT ON collections
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_collections_update AFTER UPDATE ON collections
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_collections_delete AFTER DELETE ON collections
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photos_insert AFTER INSERT ON photos
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photos_update AFTER UPDATE ON photos
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photos_delete AFTER DELETE ON photos
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photo_uploads_insert AFTER INSERT ON photo_uploads
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photo_uploads_update AFTER UPDATE ON photo_uploads
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_photo_uploads_delete AFTER DELETE ON photo_uploads
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_suggestions_insert AFTER INSERT ON suggestions
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_suggestions_update AFTER UPDATE ON suggestions
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_suggestions_delete AFTER DELETE ON suggestions
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_editors_insert AFTER INSERT ON editors
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_editors_update AFTER UPDATE ON editors
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_editors_delete AFTER DELETE ON editors
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;

CREATE TABLE IF NOT EXISTS public_ids (
  kind TEXT NOT NULL CHECK (kind IN ('person','tree')),
  entity_id TEXT NOT NULL,
  short_id TEXT NOT NULL UNIQUE CHECK (length(short_id) = 12 AND short_id NOT GLOB '*[^1-9A-HJ-NP-Za-km-z]*'),
  PRIMARY KEY(kind, entity_id)
);
CREATE TRIGGER IF NOT EXISTS public_person_delete AFTER DELETE ON people
BEGIN
  DELETE FROM public_ids WHERE kind = 'person' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS public_tree_delete AFTER DELETE ON trees
BEGIN
  DELETE FROM public_ids WHERE kind = 'tree' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS backup_public_ids_insert AFTER INSERT ON public_ids
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS backup_public_ids_delete AFTER DELETE ON public_ids
BEGIN
  UPDATE backup_state SET generation = generation + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS public_ids_immutable BEFORE UPDATE ON public_ids
BEGIN
  SELECT RAISE(ABORT, 'Public IDs are permanent');
END;
