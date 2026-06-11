const express = require("express");
const { ImapFlow } = require("imapflow");
const db = require("../db/database");
const { classify_sender } = require("../services/classifier");
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const IMAP_TIMEOUT_MS = 50000;
// Longer timeout for fetching large mailboxes (e.g. Gmail) — 5 minutes
const IMAP_FETCH_TIMEOUT_MS = 600000; // 10 minutes

// In-memory job store for background fetch tasks
const fetchJobs = new Map();

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
  // attachments: find parts with Content-Disposition: attachment or name in Content-Type
  const attachments = [];
  const dispRegex = /Content-Disposition:\s*([^\r\n]+)[\r\n]+([\s\S]*?)(?=\r\n--|\r\nContent-Disposition:|\r\nContent-Type:|$)/gi;
  let m;
  while ((m = dispRegex.exec(src))) {
    const header = m[1] || '';
    const body = m[2] || '';
    const fnMatch = header.match(/filename\*?=\s*(?:UTF-8''|\")?([^\";\r\n]+)/i) || header.match(/filename=([^;\r\n]+)/i);
    const filename = fnMatch ? fnMatch[1].replace(/^"|"$/g, '') : null;
    // try to find content-type preceding this match
    const pre = src.slice(Math.max(0, m.index - 200), m.index + 0);
    const ctMatch = pre.match(/Content-Type:\s*([^\r\n;]+)(?:;\s*name="?([^\";\r\n]+)"?)?/i);
    const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
    // detect encoding
    const encMatch = pre.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
    const enc = encMatch ? encMatch[1].toLowerCase().trim() : '';
    let dataBuf = Buffer.from('', 'utf8');
    if (enc === 'base64') {
      try { dataBuf = Buffer.from(body.replace(/\r?\n/g, ''), 'base64'); } catch (_) { dataBuf = Buffer.from(body, 'binary'); }
    } else if (enc === 'quoted-printable') {
      dataBuf = decodeQuotedPrintableToBuffer(body);
    } else {
      dataBuf = Buffer.from(body, 'binary');
    }
    if (filename && dataBuf.length > 0) attachments.push({ filename: filename.trim(), contentType, data: dataBuf });
  }
  result.attachments = attachments;
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

const insertAttachmentStmt = db.prepare(
  "INSERT INTO attachments (email_id, filename, content_type, path, created_at) VALUES (?, ?, ?, ?, ?)"
);

const selectAttachmentsByEmailStmt = db.prepare(
  "SELECT id, filename, content_type, path, created_at FROM attachments WHERE email_id = ?"
);

// For listing emails we avoid returning heavy columns (body/text/html) to keep JSON small.
const selectAllStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, fetched_at, raw_sender
  FROM emails
  ORDER BY date DESC
`);

const selectByClassificationStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, fetched_at, raw_sender
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

  return { sender, rawSender, domain, name };
}

// POST /api/fetch-emails
// Connects to IMAP, fetches latest INBOX messages and stores them in SQLite.
// Emails classified as "ignored" are skipped and not saved.
router.post("/fetch-emails", async (req, res) => {
  const { host, port, user, password, limit } = req.body || {};

  if (!host || !port || !user || !password) {
    return res.status(400).json({ error: "host, port, user and password are required" });
  }

  const numericPort = Number(port);
  const numericLimit = Number(limit) || (host && String(host).toLowerCase().includes('gmail') ? 1500 : 50);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return res.status(400).json({ error: "port must be a valid number between 1 and 65535" });
  }

  // Load all custom rules once before processing emails.
  const rules = selectAllRulesStmt.all();

  // Try multiple host/port variants if initial connect fails (e.g., netlatin.com.ar -> imap.netlatin.com.ar)
  async function tryConnectVariants(hostname, portNum, username, pass) {
    const tried = new Set();
    const candidates = [];
    // candidate hosts
    candidates.push(hostname);
    if (!hostname.toLowerCase().startsWith('imap.')) candidates.push(`imap.${hostname}`);
    if (!hostname.toLowerCase().startsWith('mail.')) candidates.push(`mail.${hostname}`);

    // candidate ports
    const ports = Array.from(new Set([portNum, 993, 143]));

    for (const h of candidates) {
      for (const p of ports) {
        const key = `${h}:${p}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const secure = p === 993;
        const c = new ImapFlow({ host: h, port: p, secure, auth: { user: username, pass } });
        try {
          await withTimeout(c.connect(), IMAP_TIMEOUT_MS, `IMAP connection timed out (${h}:${p})`);
          return { client: c, host: h, port: p, secure };
        } catch (err) {
          try {
            // best-effort close
            await c.logout();
          } catch (_) {
            try { c.close(); } catch (_) {}
          }
          // small delay between attempts to avoid rapid reconnects that may trigger IP blocks
          await new Promise((r) => setTimeout(r, 500));
          // continue to next candidate
        }
      }
    }
    throw new Error('All IMAP connection attempts failed');
  }

  // Create a job and run fetch in background, returning jobId immediately
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  fetchJobs.set(jobId, {
    id: jobId,
    status: 'running',
    fetched: 0,
    limit: numericLimit,
    startedAt: new Date().toISOString(),
    lastError: null,
    tried: [],
  });

  (async () => {
    let bgClient;
    let conn;
    try {
      conn = await tryConnectVariants(host, numericPort, user, password);
      bgClient = conn.client;
      const lock = await bgClient.getMailboxLock("INBOX");
      const rows = [];

      try {
        // per-batch control
        const perBatchTimeoutMs = 2 * 60 * 1000; // 2 minutes
        const jobInit = fetchJobs.get(jobId) || {};
        let batchSize = jobInit.batchSize || (host && String(host).toLowerCase().includes('gmail') ? 300 : 50);
        let batchFetched = 0;
        let batchStart = Date.now();

        for await (const message of bgClient.fetch("1:*", { envelope: true, internalDate: true, source: true })) {
          const { sender, rawSender, domain, name } = extractSenderInfo(message.envelope);
          const subject = message.envelope?.subject || "(No subject)";
          const dateValue = message.internalDate
            ? new Date(message.internalDate).toISOString()
            : new Date().toISOString();
          const fetchedAt = new Date().toISOString();

          const classification = classify_sender(rawSender || sender, rules);
          // Compute final classification with extra user rules
          const subj = String(subject || '').trim();
          const skipPrefix = /^\s*(Cursos|Taller)/i;
          let computedClassification = classification;
          if (subj && skipPrefix.test(subj)) {
            computedClassification = 'ignored';
          }
          // If subject or sender contains 'newsletter' or domain includes it -> ignored
          else if (/newsletter/i.test(subj) || /newsletter/i.test(rawSender) || (domain && domain.toLowerCase().includes('newsletter'))) {
            computedClassification = 'ignored';
          }
          // If the display name exactly matches 'Soluciones IT APS' -> ignored
          else if (name && String(name).trim().toLowerCase() === 'soluciones it aps') {
            computedClassification = 'ignored';
          }

          if (computedClassification === 'ignored') continue;

          let body = "";
          try {
            if (message.source) {
              body = Buffer.isBuffer(message.source) ? message.source.toString("utf8") : String(message.source);
            }
          } catch (e) { body = ""; }

          const parts = extractMessageParts(body);
          const info = insertEmailStmt.run(sender, domain, subject, dateValue, classification, fetchedAt, rawSender, body, parts.text, parts.html);
          const emailId = info && info.lastInsertRowid ? info.lastInsertRowid : null;
          // Debug logging: show whether insert created a row or was ignored due to unique index
          try {
            console.log(`[fetch:${jobId}] ${sender} (${domain}) classified=${classification} insert_changes=${info && info.changes ? info.changes : 0} id=${emailId}`);
          } catch (_) {}

          // Save attachments to disk and DB if present
          if (emailId && parts.attachments && parts.attachments.length) {
            const attachDir = path.join(__dirname, '..', 'db', 'attachments');
            try { if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true }); } catch (_) {}
            parts.attachments.forEach((att, idx) => {
              try {
                const safe = (att.filename || `attach_${idx}`).replace(/[^a-z0-9.\-_]/gi, '_');
                const fname = `${emailId}_${Date.now()}_${idx}_${safe}`;
                const full = path.join(attachDir, fname);
                fs.writeFileSync(full, att.data);
                insertAttachmentStmt.run(emailId, att.filename, att.contentType, full, new Date().toISOString());
              } catch (_) {}
            });
          }

          rows.push({ id: emailId, sender, raw_sender: rawSender, domain, subject, date: dateValue, classification, fetched_at: fetchedAt });

          // Update job progress and batch tracking
          batchFetched += 1;
          const job = fetchJobs.get(jobId) || {};
          job.fetched = rows.length;
          job.lastTried = conn && conn.host ? `${conn.host}:${conn.port}` : null;
          job.batchSize = job.batchSize || batchSize;

          // If batch completed
          if (batchFetched >= job.batchSize) {
            job.currentBatch = (job.currentBatch || 0) + 1;
            batchFetched = 0;
            batchStart = Date.now();
          } else {
            // if per-batch timeout exceeded and currently using 300, fallback to 200
            if (Date.now() - batchStart > perBatchTimeoutMs && job.batchSize === 300) {
              job.batchSize = 200;
            }
          }

          fetchJobs.set(jobId, job);
          try { console.log(`[fetch:${jobId}] progress fetched=${job.fetched} batchSize=${job.batchSize} currentBatch=${job.currentBatch || 0}`); } catch (_) {}

          if (numericLimit > 0 && rows.length >= numericLimit) break;
        }
      } finally {
        try { lock.release(); } catch (_) {}
      }

      try { await bgClient.logout(); } catch (_) {}

      const job = fetchJobs.get(jobId) || {};
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.resultCount = job.fetched || 0;
      fetchJobs.set(jobId, job);
    } catch (err) {
      const job = fetchJobs.get(jobId) || {};
      job.status = 'failed';
      job.lastError = err && err.message ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
      fetchJobs.set(jobId, job);
      try { if (bgClient) await bgClient.logout(); } catch (_) {}
    }
  })();

  return res.json({ jobId });
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

// GET attachments list for an email
router.get('/emails/:id/attachments', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
    const rows = selectAttachmentsByEmailStmt.all(id);
    return res.json(rows || []);
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

// Stream attachment by id
router.get('/attachments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
    const row = db.prepare('SELECT id, filename, content_type, path FROM attachments WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'attachment not found' });
    const filePath = row.path;
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing' });
      // For viewable types (PDF, images) prefer inline disposition so browser opens them in a new tab.
      const contentType = row.content_type || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      // Security headers to reduce content-sniffing and clickjacking risks
      try {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Download-Options', 'noopen');
        // Content-Security-Policy will be set below conditionally (we avoid strict CSP for inline binary viewers like PDF)
      } catch (_) {}
      const lower = String(contentType).toLowerCase();
      const inlineTypes = [
        'application/pdf',
        'image/png',
        'image/jpg',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'image/bmp',
        'image/tiff',
      ];
      const dispositionType = inlineTypes.includes(lower) ? 'inline' : 'attachment';
      // Normalize common jpeg content-type variants to a single header value
      let sendContentType = contentType;
      if (lower === 'image/jpg' || lower === 'image/jpeg') sendContentType = 'image/jpeg';

      // Log serving info for debugging (size, type, disposition)
      try {
        const stats = fs.statSync(filePath);
        console.log(`[attachments] serve id=${id} file=${filePath} size=${stats.size} contentType=${sendContentType} disposition=${dispositionType}`);
        if (stats.size === 0) {
          console.warn(`[attachments] file size is zero for id=${id} path=${filePath}`);
        }
      } catch (err) {
        console.warn('[attachments] failed to stat file', filePath, err && err.message);
      }
      // Only apply a restrictive CSP for attachments that will be downloaded (not for inline viewers like PDFs/images)
      try {
        if (dispositionType === 'attachment' || String(contentType).toLowerCase().includes('html')) {
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'none';");
        }
      } catch (_) {}
      // Protect filename by replacing potentially problematic chars
      const safeFilename = (row.filename || 'attachment').replace(/"/g, '');
      res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeFilename}"`);
      // Use the normalized content type header
      res.setHeader('Content-Type', sendContentType);
      // For images served inline, allow caching
      if (dispositionType === 'inline' && sendContentType.startsWith('image/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[attachments] stream error', err && err.message);
      try { res.status(500).end(); } catch (_) {}
    });
    stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
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

// GET /api/fetch-status/:id
router.get('/fetch-status/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const job = fetchJobs.get(id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const limit = job.limit || 0;
    const fetched = job.fetched || 0;
    const percent = limit > 0 ? Math.min(100, Math.round((fetched / limit) * 100)) : null;
    const batchSize = job.batchSize || 300;
    const totalBatches = limit > 0 ? Math.ceil(limit / batchSize) : null;
    const currentBatch = job.currentBatch || (limit > 0 ? Math.min(totalBatches, Math.ceil(fetched / batchSize) || 1) : null);
    return res.json({ ...job, percent, batchSize, totalBatches, currentBatch });
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

// POST /api/reclassify-spam
// Scans emails currently labeled 'spam' and reclassifies them to
// 'administracion' or 'reclamos' when their subject/sender/text matches keywords.
router.post('/reclassify-spam', (req, res) => {
  try {
    const adminKeywords = ['factura', 'facturación', 'facturacion', 'pago', 'pagos', 'recibo', 'cuenta', 'administracion', 'administración', 'tesoreria', 'tesorería', 'finanzas', 'cobro'];
    const reclamosKeywords = ['reclamo', 'reclamos', 'incidencia', 'queja', 'problema', 'soporte', 'reporte', 'reparacion', 'reparación', 'garantia', 'garantía'];

    const spamRows = db.prepare("SELECT id, subject, sender, raw_sender, coalesce(text,'') as text FROM emails WHERE classification = 'spam'").all();
    if (!spamRows || !spamRows.length) return res.json({ adminCount: 0, reclamosCount: 0, scanned: 0 });

    const updateStmt = db.prepare("UPDATE emails SET classification = ? WHERE id = ?");
    let adminCount = 0;
    let reclamosCount = 0;

    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const txt = `${r.subject || ''} ${r.sender || ''} ${r.raw_sender || ''} ${r.text || ''}`.toLowerCase();
        // prefer administracion if both match
        const isAdmin = adminKeywords.some((kw) => txt.includes(kw));
        const isReclamo = reclamosKeywords.some((kw) => txt.includes(kw));
        if (isAdmin) {
          updateStmt.run('administracion', r.id);
          adminCount++;
        } else if (isReclamo) {
          updateStmt.run('reclamos', r.id);
          reclamosCount++;
        }
      }
    });

    tx(spamRows);

    return res.json({ adminCount, reclamosCount, scanned: spamRows.length });
  } catch (err) {
    console.error('reclassify-spam failed', err && err.message);
    return res.status(500).json({ error: err && err.message });
  }
});

module.exports = router;
