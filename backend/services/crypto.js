const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const SECRET_KEY = process.env.ENCRYPTION_KEY

if (!SECRET_KEY || SECRET_KEY.length !== 64) {
  console.error(
    '[crypto] ENCRYPTION_KEY missing or invalid. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
    'and add it to backend/.env as ENCRYPTION_KEY=<value>'
  )
}

function encrypt(text) {
  if (!text) return null
  const iv = crypto.randomBytes(16)
  const key = Buffer.from(SECRET_KEY, 'hex')
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function decrypt(encryptedText) {
  if (!encryptedText) return null
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
    const key = Buffer.from(SECRET_KEY, 'hex')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (err) {
    console.error('[crypto] decryption failed:', err.message)
    return null
  }
}

module.exports = { encrypt, decrypt }