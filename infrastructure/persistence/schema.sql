CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL,
  owner TEXT,
  phase TEXT NOT NULL,
  phase_status TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requirement_id) REFERENCES requirements(id)
);
CREATE TABLE IF NOT EXISTS repository_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT,
  worktree TEXT,
  write_scope TEXT,
  delivery_status TEXT,
  checks TEXT,
  UNIQUE (delivery_id, repository_id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE TABLE IF NOT EXISTS planning_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  UNIQUE (delivery_id, change_id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  delivery_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  delivery_id TEXT,
  type TEXT NOT NULL,
  actor TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
