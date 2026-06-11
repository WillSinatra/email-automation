-- Emails table used to persist fetched IMAP messages locally.
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT,
  domain TEXT,
  subject TEXT,
  date TEXT,
  classification TEXT,
  fetched_at TEXT,
  raw_sender TEXT
);

-- Unique index to skip duplicates by sender + subject + date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_unique_sender_subject_date
ON emails(sender, subject, date);

-- Custom domain rules table for override classification.
CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain     TEXT UNIQUE,
  category   TEXT,
  created_at TEXT
);
