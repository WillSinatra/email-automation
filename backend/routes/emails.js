const express = require("express");
const { ImapFlow } = require("imapflow");
const db = require("../db/database");
const { classify_sender } = require("../services/classifier");
const iconv = require('iconv-lite');

const router = express.Router();
const IMAP_TIMEOUT_MS = 30000;

function decodeQuotedPrintableToBuffer(input) {
  if (!input) return Buffer.alloc(0);
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '=') {
      const hex = input.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      } else if (input.charAt(i + 1) === '\r' && input.charAt(i + 2) === '\n') {
        // soft line break, skip
        i += 2;
        continue;
      }
    }
    bytes.push(input.charCodeAt(i));
  }
  return Buffer.from(bytes);
}

function decodeBufferWithCharset(buf, charset) {
  try {
    const cs = charset ? String(charset).toLowerCase().replace(/^["']|["']$/g, '') : 'utf8';
    if (cs === 'utf8' || cs === 'utf-8') return iconv.decode(buf, 'utf8');
    if (iconv.encodingExists(cs)) return iconv.decode(buf, cs);
    return iconv.decode(buf, 'utf8');
  } catch (e) {
    return buf.toString('utf8');
  }
}

function stripHtml(html) {
  if (!html) return '';
  // Very small HTML to text fallback: remove scripts/styles and tags
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<[^>]+>/g, '');
  // Unescape basic HTML entities
  t = t.replace(/&nbsp;/gi, ' ');
  t = t.replace(/&amp;/gi, '&');
  t = t.replace(/&lt;/gi, '<');
  t = t.replace(/&gt;/gi, '>');
  return t.trim();
}

function extractMessageParts(rawSource) {
  const result = { text: '', html: '' };
  if (!rawSource) return result;
  const src = String(rawSource);

  function parseCharset(header) {
    const m = header && header.match(/charset\s*=\s*"?([^\";\s]+)/i);
    return m ? m[1] : null;
  }

  function findPart(mime) {
    const idx = src.search(new RegExp('Content-Type:\\s*' + mime, 'i'));
    if (idx === -1) return null;
    const headerStart = idx;
    const headerEnd = src.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    // find end of part
    let endIdx = src.indexOf('\r\n--', headerEnd);
    const nextContent = src.indexOf('\r\nContent-Type:', headerEnd);
    if (nextContent !== -1 && (endIdx === -1 || nextContent < endIdx)) endIdx = nextContent;
    if (endIdx === -1) endIdx = src.length;
    const header = src.slice(headerStart, headerEnd);
    const body = src.slice(headerEnd + 4, endIdx);
    return { header, body };
  }

  const plain = findPart('text/plain');
  if (plain) {
    const encMatch = plain.header.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
    const enc = encMatch ? encMatch[1].toLowerCase().trim() : '';
    const charset = parseCharset(plain.header) || 'utf8';
    let bodyBuf = Buffer.from(plain.body || '', 'utf8');
    if (enc === 'base64') {
      try {
        bodyBuf = Buffer.from((plain.body || '').replace(/\r?\n/g, ''), 'base64');
      } catch (_) {}
    } else if (enc === 'quoted-printable') {
      bodyBuf = decodeQuotedPrintableToBuffer(plain.body || '');
    } else {
      bodyBuf = Buffer.from(plain.body || '', 'binary');
    }
    result.text = String(decodeBufferWithCharset(bodyBuf, charset)).trim();
  }

  const htmlPart = findPart('text/html');
  if (htmlPart) {
    const encMatch = htmlPart.header.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
    const enc = encMatch ? encMatch[1].toLowerCase().trim() : '';
    const charset = parseCharset(htmlPart.header) || 'utf8';
    let bodyBuf = Buffer.from(htmlPart.body || '', 'utf8');
    if (enc === 'base64') {
      try {
        bodyBuf = Buffer.from((htmlPart.body || '').replace(/\r?\n/g, ''), 'base64');
      } catch (_) {}
    } else if (enc === 'quoted-printable') {
      bodyBuf = decodeQuotedPrintableToBuffer(htmlPart.body || '');
    } else {
      bodyBuf = Buffer.from(htmlPart.body || '', 'binary');
    }
    result.html = String(decodeBufferWithCharset(bodyBuf, charset)).trim();
    // If text wasn't found, derive from html
    if (!result.text) result.text = stripHtml(result.html);
  }

  // Fallback: if neither found, extract readable text from whole source
  if (!result.text) result.text = stripHtml(src).slice(0, 100000);
  return result;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

// Prepared statements — include raw_sender, body, text and html in insert/select.
const insertEmailStmt = db.prepare(`
  INSERT OR IGNORE INTO emails (sender, domain, subject, date, classification, fetched_at, raw_sender, body, text, html)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectAllStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, fetched_at, raw_sender, body, text, html
  FROM emails
  ORDER BY date DESC
`);

const selectByClassificationStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, fetched_at, raw_sender, body, text, html
  FROM emails
  WHERE classification = ?
  ORDER BY date DESC
`);

const selectByIdStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, fetched_at, raw_sender, body, text, html
  FROM emails
  WHERE id = ?
`);

const clearEmailsStmt = db.prepare("DELETE FROM emails");

const selectAllRulesStmt = db.prepare(
  "SELECT domain, category FROM rules"
);

// Backfill any existing rows that have a body but no extracted text/html yet.
try {
  const missing = db.prepare("SELECT id, body FROM emails WHERE (text IS NULL OR html IS NULL) AND body IS NOT NULL").all();
  if (missing && missing.length) {
    const updateText = db.prepare("UPDATE emails SET text = ?, html = ? WHERE id = ?");
    const updateTx = db.transaction((rows) => {
      for (const r of rows) {
        try {
          const parts = extractMessageParts(r.body);
          updateText.run(parts.text || '', parts.html || '', r.id);
        } catch (_) {
          updateText.run('', '', r.id);
        }
      }
    });
    updateTx(missing);
  }
} catch (err) {
  console.error('Backfill text/html failed:', err && err.message);
}

function extractSenderInfo(envelope) {
  const firstFrom = envelope?.from?.[0];
  const name = firstFrom?.name || "";

  // ImapFlow exposes the full address string in `address`.
  // Fall back to the legacy mailbox+host fields if present (older parsers).
  let sender =
    firstFrom?.address ||
    (firstFrom?.mailbox && firstFrom?.host
      ? `${firstFrom.mailbox}@${firstFrom.host}`
      : "");
  sender = String(sender).trim();

  const domain = sender.includes("@")
    ? sender.split("@")[1]?.toLowerCase().trim() || ""
    : "";

  const rawSender = name ? `${name} <${sender}>` : sender;

  return { sender, rawSender, domain };
}

// POST /api/fetch-emails
// Connects to IMAP, fetches latest INBOX messages and stores them in SQLite.
// Emails classified as "ignored" are skipped and not saved.
router.post("/fetch-emails", async (req, res) => {
  const { host, port, user, password } = req.body || {};

  if (!host || !port || !user || !password) {
    return res.status(400).json({ error: "host, port, user and password are required" });
  }

  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return res.status(400).json({ error: "port must be a valid number between 1 and 65535" });
  }

  // Load all custom rules once before processing emails.
  const rules = selectAllRulesStmt.all();

  const client = new ImapFlow({
    host,
    port: numericPort,
    secure: numericPort === 993,
    auth: { user, pass: password },
  });

  try {
    await withTimeout(
      client.connect(),
      IMAP_TIMEOUT_MS,
      "IMAP connection timed out"
    );

    const fetchedEmails = await withTimeout(
      (async () => {
        const lock = await client.getMailboxLock("INBOX");
        const rows = [];

        try {
          // Fetch every message in the INBOX (no sender pre-filtering, no unread-only filtering).
          // Request `source` to capture the raw message body so the UI can display contents.
          for await (const message of client.fetch("1:*", { envelope: true, internalDate: true, source: true })) {
            const { sender, rawSender, domain } = extractSenderInfo(message.envelope);
            const subject = message.envelope?.subject || "(No subject)";
            const dateValue = message.internalDate
              ? new Date(message.internalDate).toISOString()
              : new Date().toISOString();
            const fetchedAt = new Date().toISOString();

            // Classify every fetched sender using the backend classifier.
            const classification = classify_sender(rawSender || sender, rules);

            // Emails classified as "ignored" are not persisted.
            if (classification === "ignored") {
              continue;
            }

            // message.source may be a Buffer — convert to UTF-8 string for storage.
            let body = "";
            try {
              if (message.source) {
                body = Buffer.isBuffer(message.source) ? message.source.toString("utf8") : String(message.source);
              }
            } catch (e) {
              body = "";
            }

            const parts = extractMessageParts(body);

            insertEmailStmt.run(sender, domain, subject, dateValue, classification, fetchedAt, rawSender, body, parts.text, parts.html);

            rows.push({
              id: null,
              sender,
              raw_sender: rawSender,
              domain,
              subject,
              date: dateValue,
              classification,
              fetched_at: fetchedAt,
            });
          }
        } finally {
          lock.release();
        }

        return rows;
      })(),
      IMAP_TIMEOUT_MS,
      "IMAP fetch timed out"
    );

    await client.logout();
    return res.json(fetchedEmails);
  } catch (error) {
    try {
      await client.logout();
    } catch (_) {
      // Ignore logout errors after a failed connection.
    }

    return res.status(500).json({ error: error.message || "Failed to fetch emails" });
  }
});

// GET /api/emails
// Returns emails optionally filtered by classification (trusted | spam | ignored).
// GET /api/emails/:id
// Returns a single email by id (including stored body).
router.get("/emails/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "invalid id" });
    }

    const row = selectByIdStmt.get(id);
    if (!row) return res.status(404).json({ error: "email not found" });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load email" });
  }
});

// GET /api/emails
// Returns emails optionally filtered by classification (trusted | spam | ignored).
router.get("/emails", (req, res) => {
  try {
    const { classification } = req.query;

    if (classification) {
      if (!["trusted", "spam", "ignored"].includes(classification)) {
        return res.status(400).json({ error: "classification must be trusted, spam or ignored" });
      }

      const rows = selectByClassificationStmt.all(classification);
      return res.json(rows);
    }

    const rows = selectAllStmt.all();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load emails" });
  }
});

// DELETE /api/emails
// Clears all persisted email rows.
router.delete("/emails", (req, res) => {
  try {
    clearEmailsStmt.run();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to clear emails" });
  }
});

module.exports = router;
