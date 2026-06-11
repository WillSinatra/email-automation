const express = require("express");
const db = require("../db/database");

const router = express.Router();

// Sanitize a domain string: lowercase, trim whitespace, strip leading dots.
function sanitizeDomain(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/^\.+/, "");
}

// Basic domain format validation — must contain at least one dot and no spaces.
function isValidDomain(domain) {
  return /^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/.test(domain) && domain.includes(".");
}

const VALID_CATEGORIES = new Set(["trusted", "spam", "ignored"]);

// Prepared statements.
const upsertRuleStmt = db.prepare(`
  INSERT INTO rules (domain, category, created_at)
  VALUES (?, ?, ?)
  ON CONFLICT(domain) DO UPDATE SET
    category   = excluded.category,
    created_at = excluded.created_at
`);

const selectAllRulesStmt = db.prepare(
  "SELECT id, domain, category, created_at FROM rules ORDER BY domain ASC"
);

const deleteRuleStmt = db.prepare("DELETE FROM rules WHERE domain = ?");

const selectRuleByDomainStmt = db.prepare(
  "SELECT id, domain, category, created_at FROM rules WHERE domain = ?"
);

// POST /api/rules
// Create or update a custom domain classification rule.
router.post("/", (req, res) => {
  try {
    const rawDomain = req.body?.domain;
    const category = req.body?.category;

    if (!rawDomain || !category) {
      return res.status(400).json({ error: "domain and category are required" });
    }

    const domain = sanitizeDomain(rawDomain);

    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: "domain is not a valid domain name" });
    }

    if (!VALID_CATEGORIES.has(category)) {
      return res.status(400).json({ error: "category must be trusted, spam or ignored" });
    }

    const createdAt = new Date().toISOString();
    upsertRuleStmt.run(domain, category, createdAt);

    const rule = selectRuleByDomainStmt.get(domain);
    return res.json({ success: true, rule });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save rule" });
  }
});

// GET /api/rules
// Return all custom domain rules.
router.get("/", (req, res) => {
  try {
    const rows = selectAllRulesStmt.all();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load rules" });
  }
});

// DELETE /api/rules/:domain
// Remove a custom rule for the given domain.
router.delete("/:domain", (req, res) => {
  try {
    const domain = sanitizeDomain(req.params.domain);

    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: "domain is not a valid domain name" });
    }

    const result = deleteRuleStmt.run(domain);

    if (result.changes === 0) {
      return res.status(404).json({ error: `No rule found for domain: ${domain}` });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to delete rule" });
  }
});

module.exports = router;
