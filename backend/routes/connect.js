const express = require("express");
const { ImapFlow } = require("imapflow");
const { validateDomainMiddleware } = require('../middleware/validateDomain');
const { logEvent, isAccountLocked } = require('../middleware/auditLog');

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
router.post("/", validateDomainMiddleware, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  try {
    const host = String(req.body?.host || '').trim();
    const port = Number(req.body?.port);
    const user = String(req.body?.user || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!host || !port || !user || !password) {
      return res.status(400).json({ error: 'host, port, user and password are required' });
    }
    if (host.length > 255 || user.length > 255) {
      return res.status(400).json({ error: 'Invalid input length' });
    }

    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      return res.status(400).json({ error: "port must be a valid number between 1 and 65535" });
    }

    // Account lockout check: block if 5+ failed attempts in the last 15 minutes
    if (isAccountLocked(user)) {
      logEvent('connect_blocked_lockout', user, clientIp, false, 'Account locked due to repeated failures');
      return res.status(429).json({ 
        error: 'Esta cuenta fue bloqueada temporalmente por intentos fallidos repetidos. Intenta en 15 minutos.' 
      });
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

    logEvent('connect_attempt', user, clientIp, true);
    return res.json({ success: true });
  } catch (error) {
    const rawMessage = String(error.message || '')
    let userMessage = 'No se pudo conectar al servidor de correo.'

    if (/authentication|invalid credentials|login failed|auth/i.test(rawMessage)) {
      userMessage = 'Contraseña incorrecta.'
    } else if (/command failed/i.test(rawMessage)) {
      userMessage = 'Contraseña incorrecta.'
    } else if (/timeout|timed out/i.test(rawMessage)) {
      userMessage = 'El servidor no respondió a tiempo. Verifica tu conexión e intenta nuevamente.'
    } else if (/enotfound|getaddrinfo|dns/i.test(rawMessage)) {
      userMessage = 'No se pudo encontrar el servidor. Verifica el host ingresado.'
    } else if (/econnrefused/i.test(rawMessage)) {
      userMessage = 'El servidor rechazó la conexión. Verifica el host y puerto.'
    }

    logEvent('connect_attempt', req.body?.user || null, clientIp, false, rawMessage)
    return res.status(400).json({ success: false, error: userMessage })
  }
});

module.exports = router;
