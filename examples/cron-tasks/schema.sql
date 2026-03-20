-- Job run tracking
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name_status ON job_runs(job_name, status);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);

-- Sessions table (for cleanup task demo)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Users table (for report task demo)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily reports
CREATE TABLE IF NOT EXISTS daily_reports (
  report_date TEXT PRIMARY KEY,
  total_users INTEGER NOT NULL,
  new_users INTEGER NOT NULL,
  active_users INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);

-- Health checks
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'degraded', 'down')),
  response_time_ms INTEGER NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_checks_endpoint ON health_checks(endpoint_name, checked_at DESC);
