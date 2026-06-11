const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "db", "emails.db"));

// Add raw_sender column if not already present.
const cols = db.prepare("PRAGMA table_info(emails)").all().map((c) => c.name);
if (!cols.includes("raw_sender")) {
  db.exec("ALTER TABLE emails ADD COLUMN raw_sender TEXT");
  console.log("Added raw_sender to emails table.");
} else {
  console.log("raw_sender already exists — skipped.");
}

// Create rules table if not already present.
db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    domain     TEXT UNIQUE,
    category   TEXT,
    created_at TEXT
  )
`);
console.log("rules table ready.");

db.close();
console.log("Migration complete.");
