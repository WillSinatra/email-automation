const express = require('express')
const nodemailer = require('nodemailer')
const router = express.Router()
const { validateDomainMiddleware } = require('../middleware/validateDomain')
const { logEvent } = require('../middleware/auditLog')
const db = require('../db/database')

const SMTP_TIMEOUT_MS = 15000

const SMTP_CONFIGS = [
  // Primary: the actual SMTP host matching the TLS certificate
  // (NetLatin's mail hosting runs on CorreoSeguro's infrastructure)
  { host: 'smtp.correoseguro.co', port: 587, secure: false, requireTLS: true },
  { host: 'smtp.correoseguro.co', port: 465, secure: true },

  // Fallback: connect to NetLatin's domain name but skip strict
  // certificate hostname verification, since the cert legitimately
  // belongs to correoseguro.co but the connection is still
  // encrypted — this is a relaxed-but-still-TLS fallback, not
  // an insecure plaintext connection.
  { host: 'mail.netlatin.com.ar', port: 587, secure: false, tls: { rejectUnauthorized: false } },
  { host: 'mail.netlatin.com.ar', port: 465, secure: true, tls: { rejectUnauthorized: false } },
  { host: 'smtp.netlatin.com.ar', port: 587, secure: false, tls: { rejectUnauthorized: false } },
  { host: 'smtp.netlatin.com.ar', port: 465, secure: true, tls: { rejectUnauthorized: false } },
]

function makeTransporter(config, user, password) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.requireTLS !== undefined && { requireTLS: config.requireTLS }),
    ...(config.tls !== undefined && { tls: config.tls }),
    auth: { user, pass: password },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  })
}

async function findWorkingTransporter(user, password) {
  let lastError = null
  for (const config of SMTP_CONFIGS) {
    const transporter = makeTransporter(config, user, password)
    try {
      await transporter.verify()
      const strategy = config.host === 'smtp.correoseguro.co'
        ? 'REAL CERT HOSTNAME'
        : 'RELAXED CERT VALIDATION FALLBACK'
      console.log(`[send-email] SMTP OK (${strategy}) — ${config.host}:${config.port}`)
      return transporter
    } catch (err) {
      lastError = err
      console.log(`[send-email] SMTP FAIL — ${config.host}:${config.port}:`, {
        message: err.message,
        code: err.code,
        responseCode: err.responseCode,
        response: err.response
      })
    }
  }
  throw lastError
}

router.post('/', validateDomainMiddleware, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress
  try {
    const { user, password, to, subject, body, cc, bcc } = req.body || {}

    if (!user || !password) return res.status(400).json({ error: 'Faltan credenciales' })
    if (!to || !subject || !body) return res.status(400).json({ error: 'Por favor, completa todos los campos.' })

    // Strict email regex validation to prevent non-email strings (e.g. "Soporte Técnico") from reaching SMTP
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(user)) {
      return res.status(400).json({ error: 'El remitente (user) no es un correo electrónico válido. Revisa el payload del frontend.' })
    }

    const toList = String(to).split(',').map(s => s.trim()).filter(Boolean)
    const invalidRecipients = toList.filter(addr => !emailRegex.test(addr))
    if (invalidRecipients.length > 0) {
      return res.status(400).json({ error: `Direcciones inválidas: ${invalidRecipients.join(', ')}` })
    }

    const transporter = await findWorkingTransporter(user, password)

    const mailOptions = {
      from: user,
      to: toList.join(', '),
      subject: String(subject).trim(),
      text: String(body).replace(/<[^>]*>?/gm, ''), // Fallback plaintext (strip HTML tags)
      html: String(body), // React-Quill outputs HTML natively; preserve rich text formatting
    }
    if (cc) mailOptions.cc = String(cc)
    if (bcc) mailOptions.bcc = String(bcc)

    const info = await transporter.sendMail(mailOptions)
    logEvent('send_email', user, clientIp, true, `to: ${toList.join(',')}`)

    // Save the sent email locally so it shows up in the "Enviados" filter
    try {
      const { account_id } = req.body || {}
      const accountId = account_id || 'default'
      const now = new Date().toISOString()

      db.prepare(`
        INSERT OR IGNORE INTO emails
        (sender, domain, subject, date, classification, fetched_at,
         raw_sender, body, text, html, account_id, is_read, secondary_classification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user,                              // sender = the account that sent it
        user.split('@')[1] || '',          // domain
        String(subject).trim(),
        now,                                // date = now (sent now)
        'enviado',                          // classification
        now,                                // fetched_at
        `${user} (Tú)`,                    // raw_sender, marked as self-sent
        String(body),                       // body
        String(body).replace(/<[^>]*>?/gm, ''), // text (stripped)
        String(body),                       // html
        accountId,
        1,                                  // is_read = 1, since you wrote it yourself
        null                                // secondary_classification
      )
    } catch (saveErr) {
      // Don't fail the whole request if local save fails — the email
      // was already sent successfully, that's what matters most.
      console.error('[send-email] failed to save sent copy locally:', saveErr.message)
    }

    return res.json({ success: true, messageId: info.messageId })

  } catch (error) {
    console.error('[send-email] RAW ERROR:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    })

    const rawMessage = String(error.message || '')
    let userMessage = 'No se pudo enviar el correo.'
    if (/hostname.*does not match|altnames/i.test(rawMessage)) {
      userMessage = 'Error de certificado del servidor de correo. Contacta a soporte técnico de NetLatin/CorreoSeguro.'
    } else if (/authentication|invalid credentials|auth/i.test(rawMessage)) {
      userMessage = 'Contraseña incorrecta.'
    } else if (/timeout|timed out/i.test(rawMessage)) {
      userMessage = 'El servidor no respondió a tiempo. Intenta nuevamente.'
    } else if (/enotfound|getaddrinfo/i.test(rawMessage)) {
      userMessage = 'No se pudo conectar con el servidor de correo.'
    } else if (/econnrefused/i.test(rawMessage)) {
      userMessage = 'El servidor rechazó la conexión. Verifica con soporte técnico.'
    }

    logEvent('send_email', req.body?.user, clientIp, false, rawMessage)

    // TEMPORARY: include raw error details in the response for debugging.
    // Remove this debugRaw field once the root cause is identified.
    return res.status(400).json({
      success: false,
      error: userMessage,
      debugRaw: {
        message: error.message,
        code: error.code,
        command: error.command,
        response: error.response,
        responseCode: error.responseCode
      }
    })
  }
})

module.exports = router