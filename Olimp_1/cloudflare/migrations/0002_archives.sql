CREATE TABLE IF NOT EXISTS entity_states(kind TEXT NOT NULL CHECK(kind IN('student','cohort')),entity_id INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('archived','removed')),previous_active INTEGER,changed_at INTEGER NOT NULL,PRIMARY KEY(kind,entity_id));
CREATE TRIGGER IF NOT EXISTS entity_states_revision_insert AFTER INSERT ON entity_states BEGIN UPDATE app_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS entity_states_revision_update AFTER UPDATE ON entity_states BEGIN UPDATE app_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS entity_states_revision_delete AFTER DELETE ON entity_states BEGIN UPDATE app_meta SET revision=revision+1 WHERE id=1; END;
