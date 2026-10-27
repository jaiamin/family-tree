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
CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, maintenance INTEGER NOT NULL DEFAULT 0 CHECK(maintenance IN (0,1)));
INSERT OR IGNORE INTO schema_version(id,version) VALUES(1, 2);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL, email TEXT, picture TEXT,
  role TEXT NOT NULL CHECK(role IN ('viewer','editor','owner')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  password_hash TEXT NOT NULL, recovery_hash TEXT,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON users(role) WHERE role='owner';
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  auth_version INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(provider, subject), UNIQUE(provider,user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
  target_id TEXT REFERENCES users(id), target_version INTEGER, expires INTEGER NOT NULL, used_by TEXT, created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS automation_credentials (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS login_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL, user_id TEXT REFERENCES users(id));
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
  content_type TEXT NOT NULL, content_hash TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TRIGGER IF NOT EXISTS backup_users_insert AFTER INSERT ON users
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_users_update AFTER UPDATE ON users
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_users_delete AFTER DELETE ON users
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_identities_insert AFTER INSERT ON identities
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_identities_update AFTER UPDATE ON identities
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_identities_delete AFTER DELETE ON identities
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_activity_insert AFTER INSERT ON activity
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_activity_update AFTER UPDATE ON activity
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS backup_activity_delete AFTER DELETE ON activity
BEGIN UPDATE backup_state SET generation=generation+1 WHERE id=1; END;

/* Maintenance also blocks requests already in flight. */
CREATE TRIGGER IF NOT EXISTS pause_collections_insert BEFORE INSERT ON collections
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_collections_update BEFORE UPDATE ON collections
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_collections_delete BEFORE DELETE ON collections
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_people_insert BEFORE INSERT ON people
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_people_update BEFORE UPDATE ON people
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_people_delete BEFORE DELETE ON people
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_trees_insert BEFORE INSERT ON trees
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_trees_update BEFORE UPDATE ON trees
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_trees_delete BEFORE DELETE ON trees
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_parents_insert BEFORE INSERT ON parents
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_parents_update BEFORE UPDATE ON parents
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_parents_delete BEFORE DELETE ON parents
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_partnerships_insert BEFORE INSERT ON partnerships
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_partnerships_update BEFORE UPDATE ON partnerships
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_partnerships_delete BEFORE DELETE ON partnerships
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_tree_members_insert BEFORE INSERT ON tree_members
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_tree_members_update BEFORE UPDATE ON tree_members
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_tree_members_delete BEFORE DELETE ON tree_members
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photos_insert BEFORE INSERT ON photos
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photos_update BEFORE UPDATE ON photos
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photos_delete BEFORE DELETE ON photos
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photo_uploads_insert BEFORE INSERT ON photo_uploads
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photo_uploads_update BEFORE UPDATE ON photo_uploads
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_photo_uploads_delete BEFORE DELETE ON photo_uploads
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_suggestions_insert BEFORE INSERT ON suggestions
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_suggestions_update BEFORE UPDATE ON suggestions
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_suggestions_delete BEFORE DELETE ON suggestions
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_users_insert BEFORE INSERT ON users
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_users_update BEFORE UPDATE ON users
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_users_delete BEFORE DELETE ON users
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_identities_insert BEFORE INSERT ON identities
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_identities_update BEFORE UPDATE ON identities
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_identities_delete BEFORE DELETE ON identities
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_invitations_insert BEFORE INSERT ON invitations
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_invitations_update BEFORE UPDATE ON invitations
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_invitations_delete BEFORE DELETE ON invitations
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_automation_credentials_insert BEFORE INSERT ON automation_credentials
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_automation_credentials_update BEFORE UPDATE ON automation_credentials
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_automation_credentials_delete BEFORE DELETE ON automation_credentials
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_activity_insert BEFORE INSERT ON activity
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_activity_update BEFORE UPDATE ON activity
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
CREATE TRIGGER IF NOT EXISTS pause_activity_delete BEFORE DELETE ON activity
WHEN (SELECT maintenance FROM schema_version WHERE id=1)=1
BEGIN SELECT RAISE(ABORT, 'installation_paused'); END;
