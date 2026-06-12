const express = require("express");
const { ImapFlow } = require("imapflow");
const db = require("../db/database");
const { classify_sender } = require("../services/classifier");
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');
const { isValidEmailDate, getValidDateRange } = require('./dateFilter');

const router = express.Router();
// NOTE: removed duplicate/erroneous sqlite3/db/fs/path/uuid declarations
// router is declared above so route handlers can be defined below.
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
        // soft line break \r\n, skip
        i += 2;
        continue;
      } else if (input.charAt(i + 1) === '\n') {
        // soft line break \n, skip
        i += 1;
        continue;
      }
    }
    bytes.push(input.charCodeAt(i) & 0xFF);
  }
  return Buffer.from(bytes);
}

function countEncodingArtifacts(value) {
  const text = String(value || '');
  const matches = text.match(/\uFFFD|\u00c3.|\u00c2.|\u00e2\u20ac|\u00e2\u0080/g);
  return matches ? matches.length : 0;
}

function repairUtf8Mojibake(value) {
  let text = String(value || '');
  if (!/[\u00c3\u00c2\u00e2]/.test(text)) return text;

  for (let i = 0; i < 3; i++) {
    try {
      const repaired = Buffer.from(text, 'latin1').toString('utf8');
      if (countEncodingArtifacts(repaired) >= countEncodingArtifacts(text)) break;
      text = repaired;
    } catch (_) {
      break;
    }
  }

  return text;
}

function decodeHtmlEntitiesSafe(value) {
  if (!value) return '';

  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aacute: '\u00e1',
    eacute: '\u00e9',
    iacute: '\u00ed',
    oacute: '\u00f3',
    uacute: '\u00fa',
    Aacute: '\u00c1',
    Eacute: '\u00c9',
    Iacute: '\u00cd',
    Oacute: '\u00d3',
    Uacute: '\u00da',
    ntilde: '\u00f1',
    Ntilde: '\u00d1',
    uuml: '\u00fc',
    Uuml: '\u00dc',
    deg: '\u00b0',
    ordm: '\u00ba',
  };

  return String(value)
    .replace(/&=\r?\n\s*([a-zA-Z][a-zA-Z0-9]+);/g, '&$1;')
    .replace(/&=,?\s*([a-zA-Z][a-zA-Z0-9]+);?/g, '&$1;')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(named, name) ? named[name] : match
    ));
}

function normalizeEmailTextSafe(value) {
  return decodeHtmlEntitiesSafe(repairUtf8Mojibake(value));
}

function omitSpanishAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeStoredEmailText(value) {
  return omitSpanishAccents(normalizeEmailTextSafe(value));
}

function decodeBufferWithCharset(buf, charset) {
  try {
    const cs = charset ? String(charset).toLowerCase().replace(/^["']|["']$/g, '') : 'utf8';
    if (cs === 'utf8' || cs === 'utf-8') {
      const decoded = iconv.decode(buf, 'utf8');
      if (decoded.includes('\uFFFD')) return normalizeEmailTextSafe(iconv.decode(buf, 'windows-1252'));
      return normalizeEmailTextSafe(decoded);
    }
    if (iconv.encodingExists(cs)) return normalizeEmailTextSafe(iconv.decode(buf, cs));
    
    // fallback for unknown charsets
    const fallbackDecoded = iconv.decode(buf, 'utf8');
    if (fallbackDecoded.includes('\uFFFD')) return normalizeEmailTextSafe(iconv.decode(buf, 'windows-1252'));
    return normalizeEmailTextSafe(fallbackDecoded);
  } catch (e) {
    return normalizeEmailTextSafe(buf.toString('utf8'));
  }
}

function stripHtml(html) {
  if (!html) return '';
  // Very small HTML to text fallback: remove scripts/styles and tags
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeHtmlEntitiesSafe(t);
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
    let bodyBuf = Buffer.from(htmlPart.body || '', 'binary');
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
  if (!result.text) {
    const fallbackStr = decodeBufferWithCharset(Buffer.from(src, 'binary'), 'utf8');
    result.text = stripHtml(fallbackStr).slice(0, 100000);
  }
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

function cleanStoredEmailRows() {
  const rows = db.prepare(`
    SELECT id, subject, raw_sender, text, html
    FROM emails
  `).all();

  if (!rows || !rows.length) return 0;

  const updateStmt = db.prepare(`
    UPDATE emails
    SET subject = ?, raw_sender = ?, text = ?, html = ?
    WHERE id = ?
  `);

  let changed = 0;
  const tx = db.transaction((items) => {
    for (const row of items) {
      const subject = normalizeStoredEmailText(row.subject);
      const rawSender = normalizeStoredEmailText(row.raw_sender);
      const text = normalizeStoredEmailText(row.text);
      const html = normalizeStoredEmailText(row.html);

      if (
        subject !== (row.subject || '') ||
        rawSender !== (row.raw_sender || '') ||
        text !== (row.text || '') ||
        html !== (row.html || '')
      ) {
        updateStmt.run(subject, rawSender, text, html, row.id);
        changed++;
      }
    }
  });

  tx(rows);
  return changed;
}

// Backfill any existing rows that have a body but no extracted text/html yet.
try {
  const missing = db.prepare("SELECT id, body FROM emails WHERE (text IS NULL OR html IS NULL) AND body IS NOT NULL").all();
  if (missing && missing.length) {
    const updateText = db.prepare("UPDATE emails SET text = ?, html = ? WHERE id = ?");
    const updateTx = db.transaction((rows) => {
      for (const r of rows) {
        try {
          const parts = extractMessageParts(r.body);
          updateText.run(normalizeStoredEmailText(parts.text), normalizeStoredEmailText(parts.html), r.id);
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

try {
  const changed = cleanStoredEmailRows();
  if (changed) console.log(`[emails] normalized stored rows=${changed}`);
} catch (err) {
  console.error('Stored email normalization failed:', err && err.message);
}

function extractSenderInfo(envelope) {
  const firstFrom = envelope?.from?.[0];
  const name = normalizeStoredEmailText(firstFrom?.name || "");

  // ImapFlow exposes the full address string in `address`.
  // Fall back to the legacy mailbox+host fields if present (older parsers).
  let sender =
    firstFrom?.address ||
    (firstFrom?.mailbox && firstFrom?.host
      ? `${firstFrom.mailbox}@${firstFrom.host}`
      : "");
  sender = normalizeStoredEmailText(sender).trim();

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

  try {
    const changed = cleanStoredEmailRows();
    if (changed) console.log(`[fetch] normalized stored rows=${changed}`);
  } catch (err) {
    console.error('Stored email normalization failed before fetch:', err && err.message);
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
      // Capture internal client errors and lifecycle events for better diagnostics
      try {
        bgClient.on('error', (e) => {
          console.error(`[fetch:${jobId}] ImapFlow client error:`, e && e.stack ? e.stack : (e && e.message) || String(e));
          const jobErr = fetchJobs.get(jobId) || {};
          jobErr.lastError = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
          fetchJobs.set(jobId, jobErr);
        });
      } catch (_) {}
      try {
        bgClient.on('close', (hadError) => {
          console.warn(`[fetch:${jobId}] ImapFlow client closed; hadError=${!!hadError}`);
        });
      } catch (_) {}
      const lock = await bgClient.getMailboxLock("INBOX");
      const rows = [];

      try {
        // per-batch control
        const perBatchTimeoutMs = 2 * 60 * 1000; // 2 minutes
        const jobInit = fetchJobs.get(jobId) || {};
        // Default to smaller batches to provide finer-grained progress (50 per batch).
        let batchSize = jobInit.batchSize || 50;
        let batchFetched = 0;
        let batchStart = Date.now();

        let uids = [];
        try {
          // Fetch ALL UIDs and process newest first. This avoids unreliable IMAP 'since' date search issues.
          uids = await bgClient.search({ all: true }, { uid: true });
        } catch (searchErr) {
          console.error('IMAP SEARCH error:', searchErr && searchErr.stack ? searchErr.stack : (searchErr && searchErr.message) || String(searchErr));
          const jobErr = fetchJobs.get(jobId) || {};
          jobErr.lastError = searchErr && searchErr.message ? searchErr.message : String(searchErr);
          fetchJobs.set(jobId, jobErr);
        }

        if (!uids || uids.length === 0) {
          console.log("IMAP SEARCH returned 0 emails");
        } else {
          console.log(`IMAP SEARCH returned ${uids.length} emails`);
          
          // Reverse UIDs so we process the newest emails first.
          uids.reverse();

          const jobInitState = fetchJobs.get(jobId) || {};
          jobInitState.totalUids = uids.length;
          jobInitState.processed = 0;
          fetchJobs.set(jobId, jobInitState);

          // Process UIDs in batches to avoid sending excessively large FETCH commands
          let i = 0;
          let consecutiveOld = 0;
          const failedUids = [];
          while (i < uids.length) {
            const jobState = fetchJobs.get(jobId) || {};
            let currentBatchSize = jobState.batchSize || batchSize || 50;
            // ensure we don't request more than remaining
            currentBatchSize = Math.min(currentBatchSize, uids.length - i);
            const batchUids = uids.slice(i, i + currentBatchSize);
            let batchAttemptSize = currentBatchSize;
            let fetchedFromThisBatch = 0;
            // Try fetching this batch, if server rejects (command failed), reduce batch size and retry
            while (batchAttemptSize >= 1) {
              const tryUids = batchUids.slice(0, batchAttemptSize);
              try {
                // Some IMAP servers reject very large FETCH commands or complex UID lists.
                // Fetch each UID individually to avoid a single oversized server command.
                for (const singleUid of tryUids) {
                  if (numericLimit > 0 && rows.length >= numericLimit) break;
                  
                  // Update processed count for every UID attempted
                  const job = fetchJobs.get(jobId) || {};
                  job.processed = (job.processed || 0) + 1;
                  job.lastTried = conn && conn.host ? `${conn.host}:${conn.port}` : null;
                  fetchJobs.set(jobId, job);

                  try {
                    for await (const message of bgClient.fetch(String(singleUid), { envelope: true, internalDate: true, source: true }, { uid: true })) {
                      fetchedFromThisBatch++;
                      const msgDateStr = message.envelope?.date || message.internalDate;
                      if (!isValidEmailDate(msgDateStr)) {
                        consecutiveOld++;
                        if (consecutiveOld > 500) {
                          console.log(`[fetch:${jobId}] Reached historical emails beyond filter. Stopping.`);
                          i = uids.length; // Will break outer loop
                          break;
                        }
                        continue;
                      } else {
                        consecutiveOld = 0;
                      }

              let dateValue = new Date().toISOString();
            try {
              if (!msgDateStr) throw new Error("Missing date string");
              const msgDate = new Date(msgDateStr);
              if (isNaN(msgDate.getTime())) throw new Error("Invalid date");
              dateValue = msgDate.toISOString();
            } catch (err) {
              console.warn(`Could not parse date: ${msgDateStr}`);
            }

            const { sender, rawSender, domain, name } = extractSenderInfo(message.envelope);
            const subject = normalizeStoredEmailText(message.envelope?.subject || "(No subject)");
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

          let bodyForDb = "";
          let bodyBinary = "";
          try {
            if (message.source) {
              if (Buffer.isBuffer(message.source)) {
                bodyForDb = message.source.toString("utf8");
                bodyBinary = message.source.toString("binary");
              } else {
                bodyForDb = String(message.source);
                bodyBinary = String(message.source);
              }
            }
          } catch (e) { }

          const parts = extractMessageParts(bodyBinary);
          const info = insertEmailStmt.run(
            sender,
            domain,
            subject,
            dateValue,
            classification,
            fetchedAt,
            rawSender,
            bodyForDb,
            normalizeStoredEmailText(parts.text),
            normalizeStoredEmailText(parts.html)
          );
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
                      
                      // Update fetched count
          job.fetched = rows.length;
          fetchJobs.set(jobId, job);
                    }
                  } catch (singleErr) {
                    console.warn(`[fetch:${jobId}] Skipping UID ${singleUid} due to fetch error:`, singleErr && singleErr.message);
                    failedUids.push(singleUid);
                  }

                  // Update batch tracking
                  batchFetched += 1;
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
                  try { console.log(`[fetch:${jobId}] progress fetched=${job.fetched} processed=${job.processed} batchSize=${job.batchSize} currentBatch=${job.currentBatch || 0}`); } catch (_) {}

                  if (i >= uids.length) break; // Break out of UID loop if we reached historical emails
                  if (numericLimit > 0 && rows.length >= numericLimit) break;
                }
                // successful fetch of this tryUids range: advance i
                if (numericLimit > 0 && rows.length >= numericLimit) {
                  i = uids.length; // Stop outer loop immediately
                } else {
                  i += batchAttemptSize;
                }
                break; // break retry loop for this batch
              } catch (fetchErr) {
                console.error(`[fetch:${jobId}] IMAP FETCH error (attempt batchSize=${batchAttemptSize}):`, fetchErr && fetchErr.stack ? fetchErr.stack : (fetchErr && fetchErr.message) || String(fetchErr));
                const jobErr = fetchJobs.get(jobId) || {};
                jobErr.lastError = fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);
                fetchJobs.set(jobId, jobErr);
                // If server complained about command size, try halving the batch
                if (batchAttemptSize > 1) {
                  batchAttemptSize = Math.max(1, Math.floor(batchAttemptSize / 2));
                  // adjust batchUids to the smaller size for the next attempt
                  continue;
                } else {
                  // If even single-item fetch fails, abort entire job
                  throw fetchErr;
                }
              }
            }
          }

          // Retry failed UIDs
          if (failedUids.length > 0 && (numericLimit === 0 || rows.length < numericLimit)) {
            console.log(`[fetch:${jobId}] Retrying ${failedUids.length} failed UIDs...`);
            for (const singleUid of failedUids) {
              if (numericLimit > 0 && rows.length >= numericLimit) break;
              try {
                for await (const message of bgClient.fetch(String(singleUid), { envelope: true, internalDate: true, source: true }, { uid: true })) {
                  const msgDateStr = message.envelope?.date || message.internalDate;
                  let dateValue = new Date().toISOString();
                  try {
                    if (msgDateStr) {
                      const msgDate = new Date(msgDateStr);
                      if (!isNaN(msgDate.getTime())) dateValue = msgDate.toISOString();
                    }
                  } catch (err) {}
                  
                  const { sender, rawSender, domain, name } = extractSenderInfo(message.envelope);
                  const subject = normalizeStoredEmailText(message.envelope?.subject || "(No subject)");
                  const fetchedAt = new Date().toISOString();
                  let classification = classify_sender(rawSender || sender, rules);
                  
                  let bodyForDb = "";
                  let bodyBinary = "";
                  try {
                    if (message.source) {
                      if (Buffer.isBuffer(message.source)) {
                        bodyForDb = message.source.toString("utf8");
                        bodyBinary = message.source.toString("binary");
                      } else {
                        bodyForDb = String(message.source);
                        bodyBinary = String(message.source);
                      }
                    }
                  } catch (e) { }

                  const parts = extractMessageParts(bodyBinary);
                  const info = insertEmailStmt.run(
                    sender,
                    domain,
                    subject,
                    dateValue,
                    classification,
                    fetchedAt,
                    rawSender,
                    bodyForDb,
                    normalizeStoredEmailText(parts.text),
                    normalizeStoredEmailText(parts.html)
                  );
                  const emailId = info && info.lastInsertRowid ? info.lastInsertRowid : null;

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
                  const job = fetchJobs.get(jobId) || {};
                  job.fetched = rows.length;
                  fetchJobs.set(jobId, job);
                  console.log(`[fetch:${jobId}] Retry SUCCESS for UID ${singleUid}`);
                }
              } catch (retryErr) {
                console.warn(`[fetch:${jobId}] Retry FAILED for UID ${singleUid}:`, retryErr && retryErr.message);
              }
            }
          }
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
      console.error(`[fetch:${jobId}] background job failed:`, err && err.stack ? err.stack : (err && err.message) || String(err));
      const job = fetchJobs.get(jobId) || {};
      job.status = 'failed';
      job.lastError = err && err.stack ? err.stack : (err && err.message ? err.message : String(err));
      job.finishedAt = new Date().toISOString();
      fetchJobs.set(jobId, job);
      try { if (bgClient) await bgClient.logout(); } catch (_) {}
    }
  })();

  return res.json({ jobId });
});

// PATCH /api/emails/:id/read
// Mark an email as read (synchronous better-sqlite3 usage)
router.patch('/emails/:id/read', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'invalid id' });
    }
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
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
      // Accept both 'reclamos' (legacy) and 'soporte_tecnico', plus 'ventas' and 'administracion'
      const accepted = ["trusted", "spam", "ignored", "administracion", "reclamos", "soporte_tecnico", "ventas"];
      if (!accepted.includes(classification)) {
        return res.status(400).json({ error: "classification must be trusted, spam, ignored, administracion, reclamos, soporte_tecnico or ventas" });
      }

      // Normalize legacy 'reclamos' to internal 'soporte_tecnico' classification
      const cls = classification === 'reclamos' ? 'soporte_tecnico' : classification;

      const rows = selectByClassificationStmt.all(cls);
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
    
    // We base progress on how many UIDs we processed vs total UIDs, or limit if we hit it early.
    const limit = job.limit || 0;
    const fetched = job.fetched || 0;
    const processed = job.processed || 0;
    const totalUids = job.totalUids || 0;

    let percent = 0;
    if (limit > 0 && totalUids > 0) {
      // If we are artificially limiting the fetch size, the denominator should be the limit
      // or the total available, whichever is smaller.
      const targetCount = Math.min(limit, totalUids);
      percent = (fetched / targetCount) * 100;
    } else if (totalUids > 0) {
      // No limit, base it on processed vs total
      percent = (processed / totalUids) * 100;
    }
    
    percent = Math.min(100, Math.max(0, Math.floor(percent)));
    if (job.status === 'done') percent = 100;

    const batchSize = job.batchSize || 50;
    const totalBatches = totalUids > 0 ? Math.ceil(totalUids / batchSize) : null;
    const currentBatch = job.currentBatch || Math.ceil(processed / batchSize) || 1;

    return res.json({ ...job, percent, batchSize, totalBatches, currentBatch });
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

// POST /api/reclassify-spam
// Scans emails currently labeled 'spam' and reclassifies them to
// 'administracion' or 'soporte_tecnico' when their subject/sender/text matches keywords.
router.post('/reclassify-spam', (req, res) => {
  try {
    const adminKeywords = ['factura', 'facturación', 'facturacion', 'pago', 'pagos', 'recibo', 'cuenta', 'administracion', 'administración', 'tesoreria', 'tesorería', 'finanzas', 'cobro'];
    const soporteKeywords = ['reclamo', 'reclamos', 'incidencia', 'queja', 'problema', 'soporte', 'reporte', 'reparacion', 'reparación', 'garantia', 'garantía'];
    const ventasKeywords = [
      'presupuesto','presupuestos','cotización','cotizacion','cotizaciones','propuesta','propuestas','oferta','ofertas','pedido','pedidos','orden de compra','ordenes de compra','venta','ventas','cliente','clientes','contrato','contratos','negociación','negociacion','producto','productos','servicio','servicios','precio','precios','lista de precios','factura de venta','oportunidad','oportunidades','demo','demostración','demostracion','reunión comercial','reunion comercial','comercial','propuesta comercial','licitación','licitacion','descuento','descuentos','promoción','promocion'
    ];

    const spamRows = db.prepare("SELECT id, subject, sender, raw_sender, coalesce(text,'') as text FROM emails WHERE classification = 'spam'").all();
    if (!spamRows || !spamRows.length) return res.json({ adminCount: 0, reclamosCount: 0, ventasCount: 0, scanned: 0 });

    const updateStmt = db.prepare("UPDATE emails SET classification = ? WHERE id = ?");
    let adminCount = 0;
    let soporteCount = 0;
    let ventasCount = 0;

    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const txt = `${r.subject || ''} ${r.sender || ''} ${r.raw_sender || ''} ${r.text || ''}`.toLowerCase();
        // prefer administracion if both match
        const isAdmin = adminKeywords.some((kw) => txt.includes(kw));
        const isReclamo = soporteKeywords.some((kw) => txt.includes(kw));
        const isVenta = ventasKeywords.some((kw) => txt.includes(kw));
        if (isAdmin) {
          updateStmt.run('administracion', r.id);
          adminCount++;
        } else if (isReclamo) {
          updateStmt.run('soporte_tecnico', r.id);
          soporteCount++;
        } else if (isVenta) {
          updateStmt.run('ventas', r.id);
          ventasCount++;
        }
      }
    });

    tx(spamRows);

    // Return both 'reclamosCount' for compatibility and explicit 'soporteCount'
    return res.json({ adminCount, reclamosCount: soporteCount, soporteCount, ventasCount, scanned: spamRows.length });
  } catch (err) {
    console.error('reclassify-spam failed', err && err.message);
    return res.status(500).json({ error: err && err.message });
  }
});

router._emailTextUtils = {
  decodeBufferWithCharset,
  decodeHtmlEntities: decodeHtmlEntitiesSafe,
  normalizeEmailText: normalizeEmailTextSafe,
  normalizeStoredEmailText,
  omitSpanishAccents,
};

module.exports = router;
