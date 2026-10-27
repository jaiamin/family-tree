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
