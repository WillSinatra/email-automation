require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectRoutes = require("./routes/connect");
const emailRoutes = require("./routes/emails");
const rulesRoutes = require("./routes/rules");

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Enable CORS for local frontend development.
app.use(
  // Allow both older dev port 3000 and the current Vite port 5173.
  // This keeps development convenient; for production use a specific origin or env var.
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173"],
  })
);

// Parse JSON payloads from REST clients.
app.use(express.json());

// Health endpoint to verify API availability quickly.
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// API routes.
app.use("/api/connect", connectRoutes);
app.use("/api", emailRoutes);
app.use("/api/rules", rulesRoutes);

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
});
