const db = require('../db/database')

/**
 * Log a security-relevant event to the audit_log table.
 * Never stores passwords — only access metadata.
 */
function logEvent(eventType, accountEmail, ipAddress, success, details = '') {
  try {
    db.prepare(`
      INSERT INTO audit_log 
      (event_type, account_email, ip_address, success, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      eventType,
      accountEmail || null,
      ipAddress || null,
      success ? 1 : 0,
      details,
      new Date().toISOString()
    )
  } catch (err) {
    console.error('[audit] failed to log event:', err.message)
  }
}

/**
 * Check whether an account is locked out due to repeated failed attempts.
 * In production: locks after 5 failed attempts in 15 minutes.
 * In development: locks after 100 failed attempts (essentially disabled).
 */
function isAccountLocked(email) {
  if (!email) return false
  const threshold = process.env.NODE_ENV === 'production' ? 5 : 100
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const failures = db.prepare(`
    SELECT COUNT(*) as count FROM audit_log
    WHERE event_type = 'connect_attempt'
    AND account_email = ?
    AND success = 0
    AND created_at > ?
  `).get(email, fifteenMinAgo)
  return failures.count >= threshold
}

/**
 * Clear all failed login attempts for a given email (dev helper).
 * Safe to call in API routes; only works in non-production.
 */
function clearAccountLock(email) {
  if (process.env.NODE_ENV === 'production') return false
  if (!email) return false
  db.prepare(`
    DELETE FROM audit_log
    WHERE event_type = 'connect_attempt'
    AND account_email = ?
    AND success = 0
  `).run(email)
  return true
}

module.exports = { logEvent, isAccountLocked, clearAccountLock }
