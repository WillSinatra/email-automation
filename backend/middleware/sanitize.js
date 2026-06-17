function sanitizeString(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function sanitizeEmail(value) {
  const trimmed = sanitizeString(value, 255);
  if (!trimmed) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed) ? trimmed.toLowerCase() : null;
}

module.exports = { sanitizeString, sanitizeEmail };