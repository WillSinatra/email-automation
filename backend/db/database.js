const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Initialize a local SQLite database file inside /db.
const dbPath = path.join(__dirname, "emails.db");
const db = new Database(dbPath);

// Load and execute SQL schema on startup.
const schemaPath = path.join(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");
db.exec(schemaSql);

// Seed the rules table with example domain rules when empty to make the
// application more discoverable for new users. These are safe defaults
// and can be edited/removed via the UI.
try {
	const countStmt = db.prepare("SELECT COUNT(*) AS c FROM rules");
	const exists = countStmt.get();
	if (exists && exists.c === 0) {
		const insert = db.prepare(
			"INSERT INTO rules (domain, category, created_at) VALUES (?, ?, ?)"
		);
		const now = new Date().toISOString();
		const samples = [
			["mycompany.com", "trusted"],
			["gmail.com", "trusted"],
			["accounts.google.com", "trusted"],
			["yahoo.com", "trusted"],
			["outlook.com", "trusted"],
			["newsletter.example.com", "ignored"],
			["no-reply.example.com", "ignored"],
			["suspicious-domain.xyz", "spam"],
			["promo.example.com", "spam"],
		];

		const insertMany = db.transaction((rows) => {
			for (const r of rows) insert.run(r[0], r[1], now);
		});

		insertMany(samples);
	}
} catch (err) {
	// If seeding fails, don't crash the app — just log the error.
	console.error('Failed to seed example rules:', err && err.message);
}

// Ensure `body` column exists on `emails` table for storing raw message source.
try {
	const info = db.prepare("PRAGMA table_info(emails)").all();
	const hasBody = info.some((c) => c.name === "body");
	if (!hasBody) {
		db.exec("ALTER TABLE emails ADD COLUMN body TEXT");
	}
} catch (err) {
	console.error('Failed to ensure emails.body column:', err && err.message);
}

// Ensure `text` column exists to store a cleaned plain-text version of the message.
try {
	const info2 = db.prepare("PRAGMA table_info(emails)").all();
	const hasText = info2.some((c) => c.name === "text");
	if (!hasText) {
		db.exec("ALTER TABLE emails ADD COLUMN text TEXT");
	}
} catch (err) {
	console.error('Failed to ensure emails.text column:', err && err.message);
}

	// Ensure `html` column exists to store the decoded HTML part (if present).
	try {
		const info3 = db.prepare("PRAGMA table_info(emails)").all();
		const hasHtml = info3.some((c) => c.name === "html");
		if (!hasHtml) {
			db.exec("ALTER TABLE emails ADD COLUMN html TEXT");
		}
	} catch (err) {
		console.error('Failed to ensure emails.html column:', err && err.message);
	}

module.exports = db;
