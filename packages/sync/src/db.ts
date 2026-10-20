export type SqlValue = string | number | null;

/**
 * Accès SQLite synchrone minimal, implémenté par `expo-sqlite` (mobile) et `node:sqlite`
 * (tests). Tout le stockage local passe par cette interface.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): { changes: number };
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  transaction<T>(fn: () => T): T;
}

/** Migrations versionnées (`PRAGMA user_version`) : jamais modifiées, seulement ajoutées. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE structures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    current_version_id TEXT,
    rights TEXT NOT NULL
  );
  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    structure_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    definition TEXT NOT NULL
  );
  CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, levels TEXT NOT NULL);
  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    parent_id TEXT,
    level INTEGER NOT NULL,
    code TEXT,
    label TEXT NOT NULL,
    attributes TEXT NOT NULL,
    position INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX list_items_parent ON list_items (list_id, parent_id, archived);
  CREATE INDEX list_items_code ON list_items (code);
  -- Fiches : copie serveur (base des mutations) et vue locale (serveur + modifications en attente).
  CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    structure_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    server_data TEXT,
    local_data TEXT NOT NULL,
    revision INTEGER,
    status TEXT NOT NULL,
    state TEXT,
    author_id TEXT,
    location TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX submissions_structure ON submissions (structure_id, updated_at);
  CREATE TABLE mutations (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    submission_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    base_revision INTEGER,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX mutations_submission ON mutations (submission_id);
  CREATE TABLE uploads (
    file_id TEXT PRIMARY KEY,
    submission_id TEXT,
    uri TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE submissions_fts USING fts5(id UNINDEXED, content, tokenize = 'unicode61 remove_diacritics 2');
  `,
  // 2 — Phase 4 : workflow (état serveur / état local), tâches assignées, notifications.
  `
  ALTER TABLE submissions ADD COLUMN server_state TEXT;
  ALTER TABLE submissions ADD COLUMN task_id TEXT;
  UPDATE submissions SET server_state = state;
  ALTER TABLE mutations ADD COLUMN target_state TEXT;
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    structure_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    due_at TEXT,
    location_label TEXT,
    location TEXT,
    prefill TEXT NOT NULL,
    status TEXT NOT NULL,
    submission_id TEXT,
    -- Fiche saisie depuis la tâche, pas encore acceptée par le serveur.
    local_submission_id TEXT
  );
  CREATE INDEX tasks_start ON tasks (start_at);
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX notifications_created ON notifications (created_at);
  `,
  // 3 — Historique des fiches consultable hors ligne (dernières révisions reçues avec la fiche).
  // Les fiches déjà présentes n'en ont pas : le curseur est effacé, la synchronisation suivante
  // reprend tout (les modifications en attente sont réappliquées par-dessus).
  `
  CREATE TABLE submission_history (
    submission_id TEXT PRIMARY KEY,
    entries TEXT NOT NULL,
    total INTEGER NOT NULL
  );
  DELETE FROM meta WHERE key = 'cursor';
  `,
];

export function migrate(db: SqlDatabase): void {
  const current = db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
