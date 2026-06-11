const express = require("express");
const { ImapFlow } = require("imapflow");

const router = express.Router();
const IMAP_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

// POST /api/connect
// Performs a short-lived IMAP login test with provided credentials.
router.post("/", async (req, res) => {
  try {
    const { host, port, user, password } = req.body || {};

    if (!host || !port || !user || !password) {
      return res.status(400).json({ error: "host, port, user and password are required" });
    }

    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      return res.status(400).json({ error: "port must be a valid number between 1 and 65535" });
    }

    const client = new ImapFlow({
      host,
      port: numericPort,
      secure: numericPort === 993,
      auth: { user, pass: password },
    });

    await withTimeout(
      client.connect(),
      IMAP_TIMEOUT_MS,
      "IMAP connection timed out"
    );
    await client.logout();

    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "Failed to connect" });
  }
});

module.exports = router;
