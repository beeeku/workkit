-- Users table for the REST API example
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed data for development
INSERT OR IGNORE INTO users (email, name, role) VALUES
  ('admin@example.com', 'Admin User', 'admin'),
  ('alice@example.com', 'Alice Johnson', 'user'),
  ('bob@example.com', 'Bob Smith', 'user');
