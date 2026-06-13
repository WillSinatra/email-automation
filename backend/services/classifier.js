// Pure classification function - no DB calls here.
// Receives rules already loaded from the database as an array of { domain, category }.

// Trusted domains for the email automation tool.
const TRUSTED_SUFFIXES = [
  "gmail.com",
  "google.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.ar",
  "outlook.com",
  "yahoo.com",
  "yahoo.com.ar",
  "live.com",
  "icloud.com",
  "me.com",
];

// Exact ignored email addresses (lowercased)
const IGNORED_EMAILS = [
  "no-reply@accounts.google.com",
  "noreply@accounts.google.com",
  "notifications@linkedin.com",
  "no-reply@linkedin.com",
  "noreply@github.com",
  "no-reply@github.com",
  "noreply@twitter.com",
  "notify@twitter.com",
  "noreply@instagram.com",
  "no-reply@instagram.com",
  "noreply@facebook.com",
  "notification@facebookmail.com",
  "no-reply@youtube.com",
  "noreply@youtube.com",
  "no-reply@netflix.com",
  "info@newsletter.mercadolibre.com",
  "noreply@mercadolibre.com",
].map((s) => s.toLowerCase());

function isTrustedDomain(domain) {
  const normalized = String(domain || "").toLowerCase().trim();
  if (!normalized) return false;

  return TRUSTED_SUFFIXES.some(
    (trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`)
  );
}

function extractSenderDomain(emailAddress) {
  const cleaned = String(emailAddress || "").trim();
  if (!cleaned) return "";

  const emailMatch = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    return emailMatch[0].split("@")[1]?.toLowerCase().trim() || "";
  }

  // Accept already-normalized domain strings like "gmail.com" or "mycompany.internal".
  return cleaned.toLowerCase().trim().replace(/^<|>$/g, "");
}

function extractLocalPart(emailAddress) {
  const cleaned = String(emailAddress || '').trim();
  const emailMatch = cleaned.match(/([A-Z0-9._%+-]+)@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) return (emailMatch[1] || '').toLowerCase();
  // If the input looks like a plain local-part or <local-part>
  const m2 = cleaned.match(/^<?([A-Z0-9._%+-]+)>?$/i);
  if (m2) return (m2[1] || '').toLowerCase();
  return '';
}

// Heuristics for ignoring automated senders, mailing lists and tracking domains.
const IGNORE_LOCAL_PREFIXES = [
  'no-reply', 'noreply', 'donotreply', 'do-not-reply', 'no.reply', 'mailer-daemon', 'mailer', 'postmaster', 'bounce', 'unsubscribe'
];
const IGNORE_LOCAL_PATTERNS = [
  /list/i,
  /owner/i,
  /-request$/i,
  /request/i
];
const IGNORE_DOMAIN_KEYWORDS = [
  'mailchimp', 'sendgrid', 'amazonses', 'mailgun', 'list-manage', 'campaign', 'newsletter', 'ads', 'advert', 'tracking', 'track', 'bounce', 'bouncehandler'
];

function isIgnoredSender(emailAddress) {
  const local = extractLocalPart(emailAddress);
  const domain = extractSenderDomain(emailAddress);
  if (!local && !domain) return false;

  const l = String(local || '').toLowerCase();
  for (const p of IGNORE_LOCAL_PREFIXES) if (l.startsWith(p)) return true;
  for (const rx of IGNORE_LOCAL_PATTERNS) if (rx.test(l)) return true;

  const d = String(domain || '').toLowerCase();
  for (const kw of IGNORE_DOMAIN_KEYWORDS) if (d.includes(kw)) return true;

  // domains commonly used for mailing lists: subdomain 'lists.' or containing 'lists'
  if (d.startsWith('lists.') || d.includes('.lists.') || d.includes('lists.')) return true;

  return false;
}

/**
 * Classify an email sender domain.
 *
 * Priority order:
 *   1. Custom rule from the "rules" table (highest priority).
 *   2. Default trusted domain list.
 *   3. Everything else → "spam".
 *
 * @param {string} senderDomain - Lowercase sender domain, e.g. "gmail.com".
 * @param {Array<{domain: string, category: string}>} rulesFromDB - All rows from the rules table.
 * @returns {"trusted"|"spam"|"ignored"}
 */
function classify_sender(emailAddress, rulesFromDB) {
  const raw = String(emailAddress || '').trim();
  // extract full email if present
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const fullEmail = emailMatch ? emailMatch[0].toLowerCase() : null;

  // determine domain
  let domain = '';
  if (fullEmail) domain = fullEmail.split('@')[1];
  else if (raw && raw.indexOf('@') === -1 && raw.includes('.')) domain = raw.toLowerCase();
  else domain = '';

  if (!domain) return 'spam';

  // 1) exact email ignored
  if (fullEmail && IGNORED_EMAILS.includes(fullEmail)) return 'ignored';

  // 2) trusted domain
  if (isTrustedDomain(domain)) return 'trusted';

  // 3) fallback
  return 'spam';
}

function classifyEmail(senderDomain, rulesFromDB) {
  return classify_sender(senderDomain, rulesFromDB);
}

const IGNORED_SUBJECT_PATTERNS = [
  // Courses and training
  /curso[s]?\b/i,
  /taller[es]?\b/i,
  /capacitaci[oó]n/i,
  /entrenamiento/i,
  /formaci[oó]n/i,
  /diplomado/i,
  /seminario/i,
  /webinar/i,
  /workshop/i,
  /e-?learning/i,
  /aula virtual/i,
  /inscripci[oó]n al curso/i,

  // Consulting and professional services promos
  /consultor[ií]a[s]?\b/i,
  /consultores\b/i,
  /asesor[ií]a[s]?\b/i,
  /asesores\b/i,
  /ingenier[ií]a[s]?\b/i,
  /ingenieros\b/i,

  // Generic promotional
  /promoci[oó]n/i,
  /oferta especial/i,
  /descuento exclusivo/i,
  /newsletter/i,
  /publicidad/i,
  /no responder/i,
  /do not reply/i,
  /unsubscribe/i,
  /darse de baja/i,
];

module.exports = { classifyEmail, classify_sender, extractSenderDomain, IGNORED_SUBJECT_PATTERNS };
