const express = require("express");
const db = require("../db/database");

const router = express.Router();

// Prepared statements
const selectAllByAccountStmt = db.prepare("SELECT id, name, label, keywords, description, created_at FROM departments WHERE account_id = ? ORDER BY name ASC");
const selectByIdStmt = db.prepare("SELECT id, name, label, keywords, description, created_at FROM departments WHERE id = ?");
const insertStmt = db.prepare("INSERT INTO departments (name, label, keywords, description, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?)");
const deleteStmt = db.prepare("DELETE FROM departments WHERE id = ?");
const updateStmt = db.prepare("UPDATE departments SET name = ?, label = ?, keywords = ?, description = ? WHERE id = ?");

function sanitizeName(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// GET /api/departments
// Return all custom departments for the given account
router.get("/", (req, res) => {
  try {
    const accountId = req.query.account_id || 'default';
    const rows = selectAllByAccountStmt.all(accountId);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load departments" });
  }
});

// POST /api/departments
// Create a new department
router.post("/", (req, res) => {
  console.log('[departments POST] body received:', req.body);
  try {
    const rawName = req.body?.name;
    const label = req.body?.label || rawName;
    const keywords = req.body?.keywords || [];
    const description = req.body?.description || '';
    const accountId = req.body?.account_id || 'default';

    if (!rawName) {
      return res.status(400).json({ error: "name is required" });
    }

    const name = sanitizeName(rawName);
    if (!name || name.length < 2) {
      return res.status(400).json({ error: "name must be at least 2 characters" });
    }

    const reserved = new Set(['all', 'trusted', 'spam', 'read', 'ignored', 'ventas', 'administracion', 'soporte_tecnico']);
    if (reserved.has(name)) {
      return res.status(400).json({ error: `"${name}" is a reserved filter name` });
    }

    const createdAt = new Date().toISOString();
    const keywordsJson = JSON.stringify(Array.isArray(keywords) ? keywords : []);
    const info = insertStmt.run(name, label, keywordsJson, description, accountId, createdAt);

    if (!info || !info.lastInsertRowid) {
      return res.status(409).json({ error: `Department "${name}" already exists` });
    }

    const row = selectByIdStmt.get(info.lastInsertRowid);
    return res.json({ success: true, department: row });
  } catch (error) {
    if (error && error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Department already exists` });
    }
    return res.status(500).json({ error: error.message || "Failed to create department" });
  }
});

// PUT /api/departments/:id
// Update a department
router.put("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "invalid id" });
    }

    const rawName = req.body?.name;
    const label = req.body?.label;
    const keywords = req.body?.keywords;
    const description = req.body?.description;
    if (!rawName) {
      return res.status(400).json({ error: "name is required" });
    }

    const name = sanitizeName(rawName);
    if (!name || name.length < 2) {
      return res.status(400).json({ error: "name must be at least 2 characters" });
    }

    const reserved = new Set(['all', 'trusted', 'spam', 'read', 'ignored', 'ventas', 'administracion', 'soporte_tecnico']);
    if (reserved.has(name)) {
      return res.status(400).json({ error: `"${name}" is a reserved filter name` });
    }

    const existing = selectByIdStmt.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Department not found" });
    }

    const finalKeywords = keywords !== undefined ? JSON.stringify(Array.isArray(keywords) ? keywords : []) : existing.keywords;
    const finalDescription = description !== undefined ? description : existing.description;

    updateStmt.run(name, label || name, finalKeywords, finalDescription, id);
    const row = selectByIdStmt.get(id);
    return res.json({ success: true, department: row });
  } catch (error) {
    if (error && error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Department name already exists` });
    }
    return res.status(500).json({ error: error.message || "Failed to update department" });
  }
});

// DELETE /api/departments/:id
// Remove a department
router.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "invalid id" });
    }

    const result = deleteStmt.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Department not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to delete department" });
  }
});

module.exports = router;