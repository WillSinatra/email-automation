const express = require("express");
const { ImapFlow } = require("imapflow");
const db = require("../db/database");
const { classify_sender, IGNORED_SUBJECT_PATTERNS } = require("../services/classifier");
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');
const { isValidEmailDate, getValidDateRange, getRangeLabel } = require('./dateFilter');

const router = express.Router();
const IMAP_TIMEOUT_MS = 50000;
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
        i += 2;
        continue;
      } else if (input.charAt(i + 1) === '\n') {
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
    } catch (_) { break; }
  }
  return text;
}

function decodeHtmlEntitiesSafe(value) {
  if (!value) return '';
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa',
    Aacute: '\u00c1', Eacute: '\u00c9', Iacute: '\u00cd', Oacute: '\u00d3', Uacute: '\u00da',
    ntilde: '\u00f1', Ntilde: '\u00d1', uuml: '\u00fc', Uuml: '\u00dc', deg: '\u00b0', ordm: '\u00ba',
  };
  return String(value)
    .replace(/&=\r?\n\s*([a-zA-Z][a-zA-Z0-9]+);/g, '&$1;')
    .replace(/&=,?\s*([a-zA-Z][a-zA-Z0-9]+);?/g, '&$1;')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(named, name) ? named[name] : match);
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

function normalizeEmailRowForResponse(row) {
  if (!row) return row;
  return {
    ...row,
    subject: normalizeStoredEmailText(row.subject),
    raw_sender: normalizeStoredEmailText(row.raw_sender),
    text: Object.prototype.hasOwnProperty.call(row, 'text') ? normalizeStoredEmailText(row.text) : row.text,
    html: Object.prototype.hasOwnProperty.call(row, 'html') ? normalizeStoredEmailText(row.html) : row.html,
  };
}

function normalizeEmailRowsForResponse(rows) {
  return (rows || []).map(normalizeEmailRowForResponse);
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
    const fallbackDecoded = iconv.decode(buf, 'utf8');
    if (fallbackDecoded.includes('\uFFFD')) return normalizeEmailTextSafe(iconv.decode(buf, 'windows-1252'));
    return normalizeEmailTextSafe(fallbackDecoded);
  } catch (e) {
    return normalizeEmailTextSafe(buf.toString('utf8'));
  }
}

function stripHtml(html) {
  if (!html) return '';
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
      try { bodyBuf = Buffer.from((plain.body || '').replace(/\r?\n/g, ''), 'base64'); } catch (_) {}
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
      try { bodyBuf = Buffer.from((htmlPart.body || '').replace(/\r?\n/g, ''), 'base64'); } catch (_) {}
    } else if (enc === 'quoted-printable') {
      bodyBuf = decodeQuotedPrintableToBuffer(htmlPart.body || '');
    } else {
      bodyBuf = Buffer.from(htmlPart.body || '', 'binary');
    }
    result.html = String(decodeBufferWithCharset(bodyBuf, charset)).trim();
    if (!result.text) result.text = stripHtml(result.html);
  }

  if (!result.text) {
    const fallbackStr = decodeBufferWithCharset(Buffer.from(src, 'binary'), 'utf8');
    result.text = stripHtml(fallbackStr).slice(0, 100000);
  }

  const attachments = [];
  const dispRegex = /Content-Disposition:\s*([^\r\n]+)[\r\n]+([\s\S]*?)(?=\r\n--|\r\nContent-Disposition:|\r\nContent-Type:|$)/gi;
  let m;
  while ((m = dispRegex.exec(src))) {
    const header = m[1] || '';
    const body = m[2] || '';
    const fnMatch = header.match(/filename\*?=\s*(?:UTF-8''|\")?([^\";\r\n]+)/i) || header.match(/filename=([^;\r\n]+)/i);
    const filename = fnMatch ? fnMatch[1].replace(/^"|"$/g, '') : null;
    const pre = src.slice(Math.max(0, m.index - 200), m.index + 0);
    const ctMatch = pre.match(/Content-Type:\s*([^\r\n;]+)(?:;\s*name="?([^\";\r\n]+)"?)?/i);
    const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
    const cidMatch = pre.match(/Content-ID:\s*<([^>]+)>/i);
    const contentId = cidMatch ? cidMatch[1].trim() : null;
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
    // Use filename if present, otherwise generate one from content type
    const finalFilename = filename
      ? filename.trim()
      : `inline_image_${Date.now()}.${(contentType.split('/')[1] || 'jpg')}`;
    if (dataBuf.length > 0) {
      console.log('[attachment-extract]', {
        filename: finalFilename,
        contentType,
        contentId: contentId || '(none)',
        sizeBytes: dataBuf.length,
        encoding: enc || '(unknown)'
      });
      if (dataBuf.length < 100 && (contentType.startsWith('image/') || contentType === 'application/pdf')) {
        console.warn('[attachment-extract] SUSPICIOUSLY SMALL FILE — likely decode failure:', finalFilename, dataBuf.length, 'bytes');
      }
      attachments.push({
        filename: finalFilename,
        contentType,
        data: dataBuf,
        contentId
      });
    }
  }

  // Fallback pass: catch inline images with Content-Type: image/* and Content-Disposition: inline
  // that may not have been captured by the main dispRegex loop (e.g. Apple Mail / iPhone emails
  // with no Content-ID header and header ordering differences).
  const inlineImageRegex = /Content-Type:\s*(image\/[^\r\n;]+)(?:;\s*name=([^\r\n;]+))?\r?\n(?:[^\r\n]*\r?\n)*?Content-Disposition:\s*inline[^\r\n]*\r?\n(?:[^\r\n]*\r?\n)*?Content-Transfer-Encoding:\s*([^\r\n]+)\r?\n\r?\n([\s\S]*?)(?=\r\n--|\r\nContent-Type:|$)/gi;
  let m2;
  while ((m2 = inlineImageRegex.exec(src))) {
    const contentType = m2[1].trim();
    const rawFilename = m2[2] ? m2[2].replace(/^"|"$/g, '').trim() : null;
    const enc = m2[3].toLowerCase().trim();
    const rawBody = m2[4];
    let dataBuf;
    if (enc === 'base64') {
      try { dataBuf = Buffer.from(rawBody.replace(/\r?\n/g, ''), 'base64'); } catch (_) { continue; }
    } else {
      dataBuf = Buffer.from(rawBody, 'binary');
    }
    if (dataBuf.length === 0) continue;
    // Avoid duplicates already captured by the main dispRegex loop
    const isDuplicate = attachments.some(a =>
      a.data.length === dataBuf.length &&
      a.contentType === contentType
    );
    if (isDuplicate) continue;
    const finalFilename = rawFilename || `inline_image_${Date.now()}.${contentType.split('/')[1] || 'jpg'}`;
    console.log('[attachment-extract]', {
      filename: finalFilename,
      contentType,
      contentId: '(none — fallback inline capture)',
      sizeBytes: dataBuf.length,
      encoding: enc || '(unknown)'
    });
    if (dataBuf.length < 100 && (contentType.startsWith('image/') || contentType === 'application/pdf')) {
      console.warn('[attachment-extract] SUSPICIOUSLY SMALL FILE — likely decode failure:', finalFilename, dataBuf.length, 'bytes');
    }
    attachments.push({
      filename: finalFilename,
      contentType,
      data: dataBuf,
      contentId: null
    });
  }

  result.attachments = attachments;

  // If the body text is empty/blank but we have image attachments, show a friendly placeholder
  if (!result.text || result.text.trim().length === 0) {
    if (result.attachments && result.attachments.length > 0) {
      const imageCount = result.attachments.filter(
        a => a.contentType && a.contentType.startsWith('image/')
      ).length;
      if (imageCount > 0) {
        result.text = imageCount === 1
          ? '[Este correo contiene una imagen adjunta]'
          : `[Este correo contiene ${imageCount} imágenes adjuntas]`;
      }
    }
  }

  return result;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]);
}

const insertEmailStmt = db.prepare(`
  INSERT OR IGNORE INTO emails
  (sender, domain, subject, date, classification,
   fetched_at, raw_sender, body, text, html,
   account_id, is_read, secondary_classification)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAttachmentStmt = db.prepare(
  "INSERT INTO attachments (email_id, filename, content_type, path, created_at, content_id) VALUES (?, ?, ?, ?, ?, ?)"
);

const selectAttachmentsByEmailStmt = db.prepare(
  "SELECT id, filename, content_type, path, created_at, content_id FROM attachments WHERE email_id = ?"
);

const selectAllStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, secondary_classification, is_read, fetched_at, raw_sender
  FROM emails
  WHERE account_id = ?
  ORDER BY date DESC
`);

const selectByClassificationStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, secondary_classification, is_read, fetched_at, raw_sender
  FROM emails
  WHERE (classification = ? OR secondary_classification = ?)
  AND account_id = ?
  ORDER BY date DESC
`);

const selectByIdStmt = db.prepare(`
  SELECT id, sender, domain, subject, date, classification, secondary_classification, is_read, fetched_at, raw_sender, body, text, html
  FROM emails
  WHERE id = ? AND account_id = ?
`);

const clearEmailsStmt = db.prepare("DELETE FROM emails WHERE account_id = ?");

const selectAllRulesStmt = db.prepare("SELECT domain, category FROM rules");

function cleanStoredEmailRows() {
  const rows = db.prepare(`SELECT id, subject, raw_sender, text, html FROM emails`).all();
  if (!rows || !rows.length) return 0;
  const updateStmt = db.prepare(`UPDATE emails SET subject = ?, raw_sender = ?, text = ?, html = ? WHERE id = ?`);
  let changed = 0;
  const tx = db.transaction((items) => {
    for (const row of items) {
      const subject = normalizeStoredEmailText(row.subject);
      const rawSender = normalizeStoredEmailText(row.raw_sender);
      const text = normalizeStoredEmailText(row.text);
      const html = normalizeStoredEmailText(row.html);
      if (subject !== (row.subject || '') || rawSender !== (row.raw_sender || '') || text !== (row.text || '') || html !== (row.html || '')) {
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
        } catch (_) { updateText.run('', '', r.id); }
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
  let sender = firstFrom?.address || (firstFrom?.mailbox && firstFrom?.host ? `${firstFrom.mailbox}@${firstFrom.host}` : "");
  sender = normalizeStoredEmailText(sender).trim();
  const domain = sender.includes("@") ? sender.split("@")[1]?.toLowerCase().trim() || "" : "";
  const rawSender = name ? `${name} <${sender}>` : sender;
  return { sender, rawSender, domain, name };
}

// ===== POST /api/fetch-emails =====
router.post("/fetch-emails", async (req, res) => {
  const { host, port, user, password, limit, account_id } = req.body || {};
  if (!host || !port || !user || !password) {
    return res.status(400).json({ error: "host, port, user and password are required" });
  }
  const accountId = account_id || 'default';
  console.log('[fetch] accountId:', accountId);

  const numericPort = Number(port);
  const numericLimit = 1500;
  const BATCH_SIZE = 50;
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return res.status(400).json({ error: "port must be a valid number between 1 and 65535" });
  }

  try {
    const changed = cleanStoredEmailRows();
    if (changed) console.log(`[fetch] normalized stored rows=${changed}`);
  } catch (err) {
    console.error('Stored email normalization failed before fetch:', err && err.message);
  }

  // Called HERE, inside the handler — not at the top of the file
  const { minDate, maxDate } = getValidDateRange();

  const rules = selectAllRulesStmt.all();

  async function tryConnectVariants(hostname, portNum, username, pass) {
    const tried = new Set();
    const candidates = [];
    candidates.push(hostname);
    if (!hostname.toLowerCase().startsWith('imap.')) candidates.push(`imap.${hostname}`);
    if (!hostname.toLowerCase().startsWith('mail.')) candidates.push(`mail.${hostname}`);
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
          try { await c.logout(); } catch (_) { try { c.close(); } catch (_) {} }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    throw new Error('All IMAP connection attempts failed');
  }

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  fetchJobs.set(jobId, {
    id: jobId,
    status: 'running',
    fetched: 0,
    saved: 0,
    skipped: 0,
    limit: numericLimit,
    totalBatches: Math.ceil(numericLimit / BATCH_SIZE),
    batchSize: BATCH_SIZE,
    currentBatch: 0,
    startedAt: new Date().toISOString(),
    lastError: null,
  });

  (async () => {
    let bgClient;
    let conn;
    try {
      conn = await tryConnectVariants(host, numericPort, user, password);
      bgClient = conn.client;
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
        let uids = [];
        try {
          uids = await bgClient.search({ since: minDate }, { uid: true });
        } catch (searchErr) {
          console.error('IMAP SEARCH error:', searchErr && searchErr.stack ? searchErr.stack : (searchErr && searchErr.message) || String(searchErr));
          const jobErr = fetchJobs.get(jobId) || {};
          jobErr.lastError = searchErr && searchErr.message ? searchErr.message : String(searchErr);
          fetchJobs.set(jobId, jobErr);
        }

        console.log(`[fetch] raw UIDs from IMAP search: ${uids.length}`);

        if (!uids || uids.length === 0) {
          console.log("[fetch] IMAP SEARCH returned 0 emails");
        } else {
          // Slice UIDs to limit before processing
          uids = uids.slice(0, numericLimit);
          console.log(`[fetch] UIDs after slice: ${uids.length}`);

          // Newest first
          uids.reverse();

          // Process UIDs in fixed-size batches using stream fetch (bulk)
          let processedCount = 0;
          let savedCount = 0;
          let skippedCount = 0;
          let batchIndex = 0;
          let debugCount = 0;
          const failedUids = [];

          while (processedCount < uids.length) {
            const start = processedCount;
            const end = Math.min(start + BATCH_SIZE, uids.length);
            const batchUids = uids.slice(start, end);
            let batchAttemptSize = batchUids.length;
            batchIndex++;
            let batchFetched = 0;

            while (batchAttemptSize >= 1) {
              const tryUids = batchUids.slice(0, batchAttemptSize);
              try {
                // Bulk fetch: pass all UIDs as comma-separated string
                const uidStr = tryUids.join(',');
                for await (const message of bgClient.fetch(uidStr, { envelope: true, internalDate: true, source: true }, { uid: true })) {
                  processedCount++;
                  batchFetched++;

                  const msgDateStr = message.envelope?.date || message.internalDate;
                  if (!isValidEmailDate(msgDateStr)) continue;

                  let dateValue = new Date().toISOString();
                  try {
                    if (msgDateStr) {
                      const msgDate = new Date(msgDateStr);
                      if (!isNaN(msgDate.getTime())) dateValue = msgDate.toISOString();
                    }
                  } catch (err) {
                    console.warn(`[fetch] Could not parse date: ${msgDateStr}`);
                  }

                  const { sender, rawSender, domain, name } = extractSenderInfo(message.envelope);
                  const subject = normalizeStoredEmailText(message.envelope?.subject || "(No subject)");
                  const fetchedAt = new Date().toISOString();

                  const classification = classify_sender(rawSender || sender, rules);
                  const subj = String(subject || '').trim();
                  let computedClassification = classification;

                  // Check subject/sender against IGNORED_SUBJECT_PATTERNS
                  const subjectLower = String(subject || '').toLowerCase();
                  const senderLower = String(rawSender || sender || '').toLowerCase();
                  const searchText = `${subjectLower} ${senderLower}`;
                  const isIgnoredByPattern = IGNORED_SUBJECT_PATTERNS.some(
                    pattern => pattern.test(searchText)
                  );
                  if (isIgnoredByPattern) {
                    computedClassification = 'ignored';
                  }

                  const skipPrefix = /^\s*(Cursos|Taller)/i;
                  if (computedClassification !== 'ignored') {
                    if (subj && skipPrefix.test(subj)) {
                      computedClassification = 'ignored';
                    } else if (/newsletter/i.test(subj) || /newsletter/i.test(rawSender) || (domain && domain.toLowerCase().includes('newsletter'))) {
                      computedClassification = 'ignored';
                    } else if (name && String(name).trim().toLowerCase() === 'soluciones it aps') {
                      computedClassification = 'ignored';
                    }
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
                  } catch (e) {}

                  const parts = extractMessageParts(bodyBinary);

                  if (debugCount < 5) {
                    console.log(`[fetch:debug] email ${debugCount + 1}:`, {
                      sender,
                      subject: String(subject || '').slice(0, 50),
                      dateValue,
                      accountId,
                      finalClassification: computedClassification,
                      columnsCount: 13
                    });
                    debugCount++;
                  }

                  const info = insertEmailStmt.run(
                    sender, domain, subject, dateValue, computedClassification, fetchedAt, rawSender,
                    bodyForDb, normalizeStoredEmailText(parts.text), normalizeStoredEmailText(parts.html),
                    accountId, 0, null
                  );

                  if (debugCount <= 5) {
                    console.log(`[fetch:debug] insert result:`, {
                      changes: info.changes,
                      lastInsertRowid: info.lastInsertRowid
                    });
                  }

                  const emailId = info && info.lastInsertRowid ? info.lastInsertRowid : null;

                  if (info && info.changes > 0) {
                    savedCount++;
                  } else {
                    skippedCount++;
                    console.log(`[fetch] DUPLICATE SKIPPED:`, sender, subject, dateValue);
                  }

                  if (emailId && parts.attachments && parts.attachments.length) {
                    const attachDir = path.join(__dirname, '..', 'db', 'attachments');
                    try { if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true }); } catch (_) {}
                    parts.attachments.forEach((att, idx) => {
                      try {
                        const safe = (att.filename || `attach_${idx}`).replace(/[^a-z0-9.\-_]/gi, '_');
                        const fname = `${emailId}_${Date.now()}_${idx}_${safe}`;
                        const full = path.join(attachDir, fname);
                        fs.writeFileSync(full, att.data);

                        const stats = fs.statSync(full);
                        console.log('[attachment-save] OK:', {
                          emailId,
                          originalFilename: att.filename,
                          savedAs: fname,
                          sizeOnDisk: stats.size,
                          contentId: att.contentId || '(none)'
                        });

                        if (stats.size !== att.data.length) {
                          console.warn('[attachment-save] SIZE MISMATCH — possible write corruption:', fname);
                        }

                        insertAttachmentStmt.run(emailId, att.filename, att.contentType, full, new Date().toISOString(), att.contentId || null);
                      } catch (err) {
                        console.error('[attachment-save] FAILED:', {
                          emailId,
                          filename: att.filename,
                          error: err && err.message
                        });
                      }
                    });
                  }

                  rows.push({ id: emailId, sender, raw_sender: rawSender, domain, subject, date: dateValue, classification, fetched_at: fetchedAt });

                  // Update job progress
                  const jobState = fetchJobs.get(jobId) || {};
                  jobState.fetched = processedCount;
                  jobState.saved = savedCount;
                  jobState.skipped = skippedCount;
                  jobState.currentBatch = batchIndex;
                  fetchJobs.set(jobId, jobState);
                }

                // Batch completed successfully
                console.log(`[fetch] progress fetched=${processedCount} saved=${savedCount} skipped=${skippedCount} batch=${batchIndex}/${Math.ceil(numericLimit / BATCH_SIZE)}`);

                if (batchFetched >= BATCH_SIZE) {
                  // Mark batch complete for frontend progressive display
                  const jobState = fetchJobs.get(jobId) || {};
                  jobState.currentBatch = (jobState.currentBatch || 0) + 1;
                  batchFetched = 0;
                  jobState.hasNewBatch = true;
                  jobState.lastBatchCompletedAt = new Date().toISOString();
                  fetchJobs.set(jobId, jobState);
                }

                break; // batch succeeded, exit retry loop
              } catch (fetchErr) {
                console.error(`[fetch:${jobId}] IMAP FETCH error (batch=${batchAttemptSize}):`, fetchErr && fetchErr.message);
                const jobErr = fetchJobs.get(jobId) || {};
                jobErr.lastError = fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);
                fetchJobs.set(jobId, jobErr);
                if (batchAttemptSize > 1) {
                  batchAttemptSize = Math.max(1, Math.floor(batchAttemptSize / 2));
                  continue;
                } else {
                  failedUids.push(...tryUids);
                  break;
                }
              }
            }
          }

          // Retry failed UIDs (individually, as last resort)
          if (failedUids.length > 0) {
            console.log(`[fetch:${jobId}] Retrying ${failedUids.length} failed UIDs individually...`);
            for (const singleUid of failedUids) {
              try {
                for await (const message of bgClient.fetch(String(singleUid), { envelope: true, internalDate: true, source: true }, { uid: true })) {
                  processedCount++;
                  const msgDateStr = message.envelope?.date || message.internalDate;
                  let dateValue = new Date().toISOString();
                  try {
                    if (msgDateStr) { const msgDate = new Date(msgDateStr); if (!isNaN(msgDate.getTime())) dateValue = msgDate.toISOString(); }
                  } catch (err) {}

                  const { sender, rawSender, domain, name } = extractSenderInfo(message.envelope);
                  const subject = normalizeStoredEmailText(message.envelope?.subject || "(No subject)");
                  const fetchedAt = new Date().toISOString();
                  let classification = classify_sender(rawSender || sender, rules);

                  const subjectLower = String(subject || '').toLowerCase();
                  const senderLower = String(rawSender || sender || '').toLowerCase();
                  const searchText = `${subjectLower} ${senderLower}`;
                  if (IGNORED_SUBJECT_PATTERNS.some(p => p.test(searchText))) {
                    classification = 'ignored';
                  }
                  const skipPrefix = /^\s*(Cursos|Taller)/i;
                  if (classification !== 'ignored') {
                    if (String(subject || '').trim() && skipPrefix.test(String(subject))) classification = 'ignored';
                    else if (/newsletter/i.test(subject) || /newsletter/i.test(rawSender)) classification = 'ignored';
                    else if (name && String(name).trim().toLowerCase() === 'soluciones it aps') classification = 'ignored';
                  }

                  let bodyForDb = "";
                  let bodyBinary = "";
                  try {
                    if (message.source) {
                      if (Buffer.isBuffer(message.source)) {
                        bodyForDb = message.source.toString("utf8");
                        bodyBinary = message.source.toString("binary");
                      } else { bodyForDb = String(message.source); bodyBinary = String(message.source); }
                    }
                  } catch (e) {}

                  const parts = extractMessageParts(bodyBinary);
                  const info = insertEmailStmt.run(sender, domain, subject, dateValue, classification, fetchedAt, rawSender, bodyForDb, normalizeStoredEmailText(parts.text), normalizeStoredEmailText(parts.html), accountId, 0, null);
                  const emailId = info && info.lastInsertRowid ? info.lastInsertRowid : null;
                  if (info && info.changes > 0) savedCount++; else skippedCount++;
                  if (emailId && parts.attachments && parts.attachments.length) {
                    const attachDir = path.join(__dirname, '..', 'db', 'attachments');
                    try { if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true }); } catch (_) {}
                    parts.attachments.forEach((att, idx) => {
                      try {
                        const safe = (att.filename || `attach_${idx}`).replace(/[^a-z0-9.\-_]/gi, '_');
                        const fname = `${emailId}_${Date.now()}_${idx}_${safe}`;
                        const full = path.join(attachDir, fname);
                        fs.writeFileSync(full, att.data);

                        const stats = fs.statSync(full);
                        console.log('[attachment-save] OK:', {
                          emailId,
                          originalFilename: att.filename,
                          savedAs: fname,
                          sizeOnDisk: stats.size,
                          contentId: att.contentId || '(none)'
                        });

                        if (stats.size !== att.data.length) {
                          console.warn('[attachment-save] SIZE MISMATCH — possible write corruption:', fname);
                        }

                        insertAttachmentStmt.run(emailId, att.filename, att.contentType, full, new Date().toISOString(), att.contentId || null);
                      } catch (err) {
                        console.error('[attachment-save] FAILED:', {
                          emailId,
                          filename: att.filename,
                          error: err && err.message
                        });
                      }
                    });
                  }
                  rows.push({ id: emailId, sender, raw_sender: rawSender, domain, subject, date: dateValue, classification, fetched_at: fetchedAt });
                  console.log(`[fetch:${jobId}] Retry SUCCESS for UID ${singleUid}`);
                }
              } catch (retryErr) {
                console.warn(`[fetch:${jobId}] Retry FAILED for UID ${singleUid}:`, retryErr && retryErr.message);
              }
            }
          }

          console.log(`[fetch] done. saved: ${savedCount}, skipped: ${skippedCount}, total processed: ${processedCount}`);
        }
      } finally {
        try { lock.release(); } catch (_) {}
      }

      try { await bgClient.logout(); } catch (_) {}

      const job = fetchJobs.get(jobId) || {};
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.resultCount = rows.length;
      job.saved = job.saved || 0;
      job.skipped = job.skipped || 0;
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
router.patch('/emails/:id/read', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

// GET /api/date-range
router.get('/date-range', (req, res) => {
  try {
    const { minDate, maxDate } = getValidDateRange();
    return res.json({
      from: minDate.toISOString(),
      to: maxDate.toISOString(),
      label: getRangeLabel()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/counts
router.get('/emails/counts', (req, res) => {
  try {
    const accountId = req.query.account_id || 'default';
    const rows = db.prepare(`SELECT classification, COUNT(*) as count FROM emails WHERE account_id = ? GROUP BY classification`).all(accountId);
    const counts = {};
    rows.forEach(r => { counts[r.classification] = r.count });
    return res.json(counts);
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

function resolveCidReferences(html, emailId) {
  if (!html) return html;
  const attachments = selectAttachmentsByEmailStmt.all(emailId);
  
  let resolved = html.replace(
    /src=["']cid:([^"']+)["']/gi,
    (match, cid) => {
      const cleanCid = cid.trim();
      const found = attachments.find(a => a.content_id === cleanCid);
      if (found) {
        console.log('[cid-resolve] matched:', cleanCid, '->', found.filename);
        return `src="/api/attachments/${found.id}"`;
      }
      console.warn('[cid-resolve] NO MATCH for cid:', cleanCid, '- available content_ids:',
        attachments.map(a => a.content_id || '(none)'));
      return `src="" data-cid-missing="${cleanCid}" alt="Imagen no disponible"`;
    }
  );
  return resolved;
}

function rewriteExternalImages(html) {
  if (!html) return html;
  // Rewrite external http/https image src URLs to go through our proxy
  // This bypasses CORS/hotlink protection from webmail providers (Cause A).
  // Skip src that are already cid: resolved (attachments) or already proxied.
  return html.replace(
    /src=["'](https?:\/\/[^"']+)["']/gi,
    (match, url) => {
      // Skip if already a local reference (attachment, proxy, data URI)
      if (url.includes('/api/attachments/') || url.includes('/api/image-proxy')) {
        return match;
      }
      console.log('[rewriteExternalImages] proxying external image:', url.slice(0, 100));
      const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
      // Add an onerror so if the proxy also fails (dead/auth-gated URL),
      // the client shows a clear Spanish message instead of a broken icon
      return `src="${proxiedUrl}" onerror="console.log('[img-proxy] proxy failed for', '${encodeURIComponent(url)}');this.outerHTML='<span class=\\'image-blocked\\'>Esta imagen no se pudo cargar porque el remitente la subi\u00f3 a un servicio externo (no fue adjuntada al correo). El enlace puede haber expirado o requerir acceso a la cuenta original del remitente. Ped\u00ed al remitente que reenv\u00ede la imagen como archivo adjunto.</span>'"`;
    }
  );
}

// GET /api/emails/:id
router.get("/emails/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "invalid id" });
    const accountId = req.query.account_id || 'default';
    const row = selectByIdStmt.get(id, accountId);
    if (!row) return res.status(404).json({ error: "email not found" });
    
    const normalizedRow = normalizeEmailRowForResponse(row);
    if (normalizedRow.html) {
      normalizedRow.html = resolveCidReferences(normalizedRow.html, id);
      normalizedRow.html = rewriteExternalImages(normalizedRow.html);
    }
    return res.json(normalizedRow);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load email" });
  }
});

// GET /api/emails
router.get("/emails", (req, res) => {
  try {
    const { classification } = req.query;
    const accountId = req.query.account_id || 'default';
    if (classification) {
      const accepted = ["trusted", "spam", "ignored", "enviado", "administracion", "reclamos", "soporte_tecnico", "ventas"];
      if (!accepted.includes(classification)) {
        return res.status(400).json({ error: "classification must be trusted, spam, ignored, enviado, administracion, reclamos, soporte_tecnico or ventas" });
      }
      const cls = classification === 'reclamos' ? 'soporte_tecnico' : classification;
      const rows = selectByClassificationStmt.all(cls, cls, accountId);
      return res.json(normalizeEmailRowsForResponse(rows));
    }
    const rows = selectAllStmt.all(accountId);
    return res.json(normalizeEmailRowsForResponse(rows));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load emails" });
  }
});

// GET /api/emails/:id/attachments
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

// GET /api/attachments/:id
router.get('/attachments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
    const row = db.prepare('SELECT id, filename, content_type, path FROM attachments WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'attachment not found' });
    const filePath = row.path;
    if (!fs.existsSync(filePath)) {
      console.error('[attachment-serve] FILE MISSING ON DISK:', {
        attachmentId: id,
        expectedPath: filePath,
        filename: row.filename
      });
      return res.status(404).json({ error: 'file missing' });
    }

    try {
      const stats = fs.statSync(filePath);
      console.log('[attachment-serve] serving:', {
        attachmentId: id,
        filename: row.filename,
        contentType: row.content_type,
        sizeBytes: stats.size
      });
      if (stats.size === 0) {
        console.warn('[attachment-serve] FILE IS EMPTY (0 bytes):', row.filename);
      }
    } catch (err) {
      console.error('[attachment-serve] stat failed:', err.message);
    }

    const contentType = row.content_type || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Download-Options', 'noopen');
    } catch (_) {}
    const lower = String(contentType).toLowerCase();
    const inlineTypes = ['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff'];
    const dispositionType = inlineTypes.includes(lower) ? 'inline' : 'attachment';
    let sendContentType = contentType;
    if (lower === 'image/jpg' || lower === 'image/jpeg') sendContentType = 'image/jpeg';
    try {
      if (dispositionType === 'attachment' || String(contentType).toLowerCase().includes('html')) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'none';");
      }
    } catch (_) {}
    const safeFilename = (row.filename || 'attachment').replace(/"/g, '');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeFilename}"`);
    res.setHeader('Content-Type', sendContentType);
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

// GET /api/image-proxy — Proxy external images to bypass CORS/hotlink protection
router.get('/image-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    // Basic safety: only allow http/https URLs, prevent SSRF to internal IPs
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'invalid url' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'only http/https allowed' });
    }
    // Block obviously internal/private addresses
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
    if (blockedHosts.includes(parsed.hostname)) {
      return res.status(400).json({ error: 'blocked host' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NetLatinMailViewer/1.0)'
      },
      redirect: 'follow'
    });

    console.log('[image-proxy] fetch result:', {
      url: url.slice(0, 150),
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type')
    });

    if (!response.ok) {
      console.warn('[image-proxy] UPSTREAM FAILED — likely CAUSE B/C (dead or auth-gated URL):', url.slice(0, 150), response.status);
      return res.status(response.status).json({ error: 'upstream fetch failed' });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'not an image' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[image-proxy] EXCEPTION — could be CORS-irrelevant network/DNS issue:', url.slice(0, 150), err.message);
    return res.status(500).json({ error: 'failed to proxy image' });
  }
});

// Temporary diagnostic endpoint to test if an image URL is fetchable from the backend
// (to determine whether the failure is CORS/hotlink (Cause A) or a dead/auth-gated URL (Cause B/C))
router.get('/debug-image-fetch', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url query param required' });
    const response = await fetch(url, { redirect: 'follow' });
    return res.json({
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      headers: Object.fromEntries(response.headers.entries())
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/emails
router.delete("/emails", (req, res) => {
  try {
    const accountId = req.query.account_id || 'default';
    clearEmailsStmt.run(accountId);
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

    // PROBLEM E+F: Return clean status with saved/skipped and exact values
    const fetched = job.fetched || 0;
    const limit = job.limit || 1500;
    let percent = limit > 0 ? Math.min(100, Math.round((fetched / limit) * 100)) : 0;
    if (job.status === 'done') percent = 100;

    // Return hasNewBatch and then clear it so frontend only refreshes once per batch
    const hasNewBatch = !!job.hasNewBatch;
    if (hasNewBatch) {
      job.hasNewBatch = false;
      fetchJobs.set(id, job);
    }

    return res.json({
      id: job.id,
      status: job.status,
      fetched: fetched,
      saved: job.saved || 0,
      skipped: job.skipped || 0,
      limit: limit,
      percent: percent,
      batchSize: job.batchSize || 50,
      totalBatches: job.totalBatches || 30,
      currentBatch: job.currentBatch || 0,
      hasNewBatch,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      lastError: job.lastError || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err && err.message });
  }
});

// POST /api/reclassify-spam
router.post('/reclassify-spam', (req, res) => {
  try {
    const accountId = req.query.account_id || req.body.account_id || 'default';
    const adminKeywords = [
      'factura','facturación','facturacion','pago','pagos','recibo','cuenta',
      'administracion','administración','tesoreria','tesorería','finanzas',
      'cobro','cobros','liquidación','liquidacion','balance','presupuesto administrativo',
      'orden de pago','transferencia','cheque','débito','credito','crédito'
    ];

    const soporteKeywords = [
      // original soporte keywords
      'soporte','técnico','tecnico','asistencia','configuración','configuracion',
      'diagnóstico','diagnostico','instalación','instalacion','reparación',
      'reparacion','ticket','incidente','router','modem','ont','onu',
      'fibra óptica','fibra optica','señal','velocidad','ping','latencia',
      'reconexión','reconexion','reinicio','reset','puerto','ip','dns',
      // merged from reclamos
      'reclamo','reclamos','queja','quejas','problema','incidencia','reporte',
      'falla','fallas','inconveniente','disconformidad','insatisfecho',
      'no funciona','sin servicio','cortado','caído','baja de señal',
      'corte','sin internet','sin conexión','sin conexion','no conecta',
      'lentitud','lento','intermitente','inestable'
    ];

    const ventasKeywords = [
      'presupuesto','cotización','cotizacion','propuesta','oferta','pedido',
      'orden de compra','venta','ventas','cliente','contrato','negociación',
      'negociacion','precio','lista de precios','factura de venta','oportunidad',
      'demo','demostración','demostracion','reunión comercial','comercial',
      'licitación','licitacion','descuento','promoción','promocion'
    ];

    const instalacionesKeywords = [
      'instalación','instalacion','nueva conexión','nueva conexion',
      'alta de servicio','activación','activacion','obra','cableado',
      'tendido','nodo','punto de acceso','acometida','manga','empalme',
      'splitter','patch cord','olt','pon','gpon','epon','ftth','fttb',
      'visita técnica','visita tecnica'
    ];

    const MOVE_TO_IGNORED_PATTERNS = [
      /curso[s]?\b/i,
      /taller[es]?\b/i,
      /capacitaci[oó]n/i,
      /consultor[ií]a[s]?\b/i,
      /asesor[ií]a[s]?\b/i,
      /ingenier[ií]a[s]?\b/i,
      /seminario/i,
      /webinar/i,
      /workshop/i,
      /promoci[oó]n/i,
      /oferta especial/i,
      /newsletter/i,
      /publicidad/i,
    ];

    // First pass: move admin emails that are actually promos to ignored
    const adminRows = db.prepare(
      "SELECT id, subject, coalesce(text,'') as text FROM emails WHERE classification = 'administracion' AND account_id = ?"
    ).all(accountId);

    const moveToIgnored = db.prepare(
      "UPDATE emails SET classification = 'ignored', secondary_classification = NULL WHERE id = ?"
    );

    let movedToIgnoredCount = 0;
    const moveTx = db.transaction((rows) => {
      for (const r of rows) {
        const txt = String(r.subject || '').toLowerCase();
        const shouldMove = MOVE_TO_IGNORED_PATTERNS.some(p => p.test(txt));
        if (shouldMove) {
          moveToIgnored.run(r.id);
          movedToIgnoredCount++;
        }
      }
    });
    moveTx(adminRows);

    // Then continue with spam reclassification
    const spamRows = db.prepare("SELECT id, subject, sender, raw_sender, coalesce(text,'') as text FROM emails WHERE classification = 'spam' AND account_id = ?").all(accountId);
    if (!spamRows || !spamRows.length) {
      return res.json({ scanned: 0, adminCount: 0, soporteCount: 0, ventasCount: 0, instalacionesCount: 0, movedToIgnored: movedToIgnoredCount });
    }

    const updateStmt = db.prepare("UPDATE emails SET classification = ? WHERE id = ?");
    let adminCount = 0;
    let soporteCount = 0;
    let ventasCount = 0;
    let instalacionesCount = 0;

    const deptMatchCounts = {};

    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const txt = `${r.subject || ''} ${r.sender || ''} ${r.raw_sender || ''} ${r.text || ''}`.toLowerCase();
        const isAdmin = adminKeywords.some(kw => txt.includes(kw));
        const isSoporte = soporteKeywords.some(kw => txt.includes(kw));

        if (isAdmin && isSoporte) {
          // Dual classification: primary = administracion, secondary = soporte_tecnico
          updateStmt.run('administracion', r.id);
          db.prepare("UPDATE emails SET secondary_classification = 'soporte_tecnico' WHERE id = ?").run(r.id);
          adminCount++;
        } else if (isAdmin) {
          updateStmt.run('administracion', r.id);
          db.prepare("UPDATE emails SET secondary_classification = NULL WHERE id = ?").run(r.id);
          adminCount++;
        } else if (isSoporte) {
          updateStmt.run('soporte_tecnico', r.id);
          db.prepare("UPDATE emails SET secondary_classification = NULL WHERE id = ?").run(r.id);
          soporteCount++;
        } else if (ventasKeywords.some((kw) => txt.includes(kw))) {
          updateStmt.run('ventas', r.id);
          ventasCount++;
        } else if (instalacionesKeywords.some((kw) => txt.includes(kw))) {
          updateStmt.run('instalaciones', r.id);
          instalacionesCount++;
        }
      }
    });
    tx(spamRows);

    // Second pass: reclassify remaining still-spam emails using department keywords from DB
    try {
      const departments = db.prepare(
        "SELECT id, name, keywords FROM departments WHERE account_id = ?"
      ).all(accountId);

      if (departments && departments.length > 0) {
        // Collect all builtin classification names that are already handled above
        const builtinNames = new Set(['administracion', 'soporte_tecnico', 'ventas', 'instalaciones']);

        // Only consider user-defined departments (not builtin ones, already handled)
        const userDepts = departments.filter(d => !builtinNames.has(d.name));

        if (userDepts.length > 0) {
          // Get emails still classified as spam after the first pass
          const remainingSpam = db.prepare(
            "SELECT id, subject, sender, raw_sender, coalesce(text,'') as text FROM emails WHERE classification = 'spam' AND account_id = ?"
          ).all(accountId);

          const deptUpdateStmt = db.prepare("UPDATE emails SET classification = ? WHERE id = ?");

          const deptTx = db.transaction((rows) => {
            for (const r of rows) {
              const txt = `${r.subject || ''} ${r.sender || ''} ${r.raw_sender || ''} ${r.text || ''}`.toLowerCase();
              for (const dept of userDepts) {
                let kwList;
                try {
                  kwList = JSON.parse(dept.keywords || '[]');
                } catch (_) {
                  kwList = [];
                }
                if (kwList.length > 0 && kwList.some(kw => txt.includes(String(kw).toLowerCase()))) {
                  deptUpdateStmt.run(dept.name, r.id);
                  deptMatchCounts[dept.name] = (deptMatchCounts[dept.name] || 0) + 1;
                  break; // first matching department wins
                }
              }
            }
          });
          deptTx(remainingSpam);
        }
      }
    } catch (deptErr) {
      console.error('[reclassify] department keyword matching failed:', deptErr.message);
    }

    return res.json({
      scanned: spamRows.length,
      adminCount,
      soporteCount,
      ventasCount,
      instalacionesCount,
      movedToIgnored: movedToIgnoredCount,
      ...deptMatchCounts
    });
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