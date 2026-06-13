-- Emails table used to persist fetched IMAP messages locally.
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT,
  domain TEXT,
  subject TEXT,
  date TEXT,
  classification TEXT,
  fetched_at TEXT,
  raw_sender TEXT,
  body TEXT,
  text TEXT,
  html TEXT,
  account_id TEXT DEFAULT 'default',
  is_read INTEGER DEFAULT 0,
  secondary_classification TEXT DEFAULT NULL
);

-- Unique index to skip duplicates by sender + subject + date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_unique
ON emails (sender, subject, date, account_id);

-- Custom domain rules table for override classification.
CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain     TEXT UNIQUE,
  category   TEXT,
  created_at TEXT
);
