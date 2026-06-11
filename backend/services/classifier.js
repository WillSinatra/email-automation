// Pure classification function — no DB calls here.
// Receives rules already loaded from the database as an array of { domain, category }.

// Trusted domains for the email automation tool.
const TRUSTED_SUFFIXES = [
  "gmail.com",
  "google.com",
  "accounts.google.com",
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
  const domain = extractSenderDomain(emailAddress);
  const rules = Array.isArray(rulesFromDB) ? rulesFromDB : [];

  if (!domain) return "spam";

  const customRule = rules.find((rule) => String(rule?.domain || "").toLowerCase().trim() === domain);
  if (customRule) return customRule.category || "spam";

  return isTrustedDomain(domain) ? "trusted" : "spam";
}

function classifyEmail(senderDomain, rulesFromDB) {
  return classify_sender(senderDomain, rulesFromDB);
}

module.exports = { classifyEmail, classify_sender, extractSenderDomain };
