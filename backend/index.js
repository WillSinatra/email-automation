require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const db = require("./db/database");

const connectRoutes = require("./routes/connect");
const emailRoutes = require("./routes/emails");
const rulesRoutes = require("./routes/rules");
const departmentRoutes = require("./routes/departments");
const accountsRoutes = require("./routes/accounts");

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Security headers via helmet (CSP disabled for local dev with inline scripts)
app.use(helmet({
  contentSecurityPolicy: false,
}));

// Environment-aware CORS configuration
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.PRODUCTION_ORIGIN]
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Parse JSON payloads from REST clients.
app.use(express.json({ limit: '2mb' }));

// Health endpoint to verify API availability quickly.
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// API routes.
const rateLimit = require('express-rate-limit');
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP
  message: { error: 'Demasiados intentos de conexión. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/connect", connectLimiter, connectRoutes);
app.use("/api/rules", rulesRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api", emailRoutes);

// Audit log viewing endpoint
app.get('/api/audit-log', (req, res) => {
  try {
    const { account_email, limit } = req.query;
    const max = Math.min(Number(limit) || 100, 500);
    let rows;
    if (account_email) {
      rows = db.prepare(`
        SELECT event_type, account_email, ip_address, success, details, created_at
        FROM audit_log WHERE account_email = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(account_email, max);
    } else {
      rows = db.prepare(`
        SELECT event_type, account_email, ip_address, success, details, created_at
        FROM audit_log ORDER BY created_at DESC LIMIT ?
      `).all(max);
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

console.log('[server] routes mounted: /api/connect, /api/emails, /api/rules, /api/departments, /api/accounts, /api/audit-log');

// Catch-all for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Centralized error handler fallback.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Email automation API running on http://localhost:${PORT}`);
  console.log('[server] registered routes:',
    app._router.stack
      .filter(r => r.route || r.name === 'router')
      .map(r => r.regexp.toString().slice(0, 60))
  );
});
