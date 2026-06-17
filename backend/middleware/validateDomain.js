const ALLOWED_DOMAINS = ['netlatin.com.ar']

function isAllowedEmail(email) {
  if (!email || typeof email !== 'string') return false
  const parts = email.toLowerCase().trim().split('@')
  if (parts.length !== 2) return false
  const domain = parts[1]
  return ALLOWED_DOMAINS.includes(domain)
}

function validateDomainMiddleware(req, res, next) {
  const email = req.body?.user || req.body?.email
  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ 
      error: 'Solo se permiten correos del dominio netlatin.com.ar' 
    })
  }
  next()
}

module.exports = { isAllowedEmail, validateDomainMiddleware, ALLOWED_DOMAINS }
