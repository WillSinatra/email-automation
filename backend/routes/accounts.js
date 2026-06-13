const express = require('express')
const router = express.Router()
const db = require('../db/database')
const crypto = require('crypto')

const MAX_ACCOUNTS = 7

// GET /api/accounts — list all accounts (never return passwords)
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, email, host, port, label, is_admin, created_at FROM accounts ORDER BY created_at ASC'
    ).all()
    return res.json(rows)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/accounts — register a new account (max 7)
router.post('/', (req, res) => {
  try {
    const { email, host, port, label } = req.body || {}
    if (!email) return res.status(400).json({ error: 'email is required' })

    const count = db.prepare('SELECT COUNT(*) as c FROM accounts').get()
    if (count.c >= MAX_ACCOUNTS) {
      return res.status(400).json({ 
        error: 'Maximum of 7 accounts reached' 
      })
    }

    const existing = db.prepare(
      'SELECT id FROM accounts WHERE email = ?'
    ).get(String(email).toLowerCase().trim())
    if (existing) {
      return res.status(409).json({ error: 'Account already exists' })
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const isAdmin = String(email).toLowerCase().trim() === 
                    'administracion@netlatin.com.ar' ? 1 : 0

    db.prepare(`
      INSERT INTO accounts (id, email, host, port, label, is_admin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(email).toLowerCase().trim(),
      host || 'imap.netlatin.com.ar',
      Number(port) || 993,
      label || email,
      isAdmin,
      now
    )

    // If admin account, seed all default departments for it
    if (isAdmin) {
      seedAdminDepartments(id)
    }

    const created = db.prepare(
      'SELECT id, email, host, port, label, is_admin, created_at FROM accounts WHERE id = ?'
    ).get(id)
    return res.status(201).json(created)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// DELETE /api/accounts/:id — remove account and its data
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
    if (!account) return res.status(404).json({ error: 'Account not found' })
    if (account.is_admin) {
      return res.status(400).json({ 
        error: 'Cannot delete the admin account' 
      })
    }
    db.prepare('DELETE FROM emails WHERE account_id = ?').run(id)
    db.prepare('DELETE FROM departments WHERE account_id = ?').run(id)
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    return res.json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// PATCH /api/accounts/:id — update host/port/label
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params
    const { host, port, label } = req.body || {}
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
    if (!account) return res.status(404).json({ error: 'Account not found' })
    db.prepare(`
      UPDATE accounts SET
        host = COALESCE(?, host),
        port = COALESCE(?, port),
        label = COALESCE(?, label)
      WHERE id = ?
    `).run(host || null, port ? Number(port) : null, label || null, id)
    const updated = db.prepare(
      'SELECT id, email, host, port, label, is_admin, created_at FROM accounts WHERE id = ?'
    ).get(id)
    return res.json(updated)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

function seedAdminDepartments(accountId) {
  const depts = [
    { name: 'ventas', label: 'Ventas', 
      description: 'Presupuestos, cotizaciones y propuestas comerciales',
      keywords: ['presupuesto','cotización','propuesta','oferta','venta','cliente','contrato','precio','licitación','descuento'] },
    { name: 'administracion', label: 'Administración',
      description: 'Facturas, pagos, recibos y gestión contable',
      keywords: ['factura','pago','recibo','cuenta','tesorería','finanzas','cobro','liquidación','transferencia'] },
    { name: 'reclamos', label: 'Reclamos',
      description: 'Quejas e incidencias de clientes',
      keywords: ['reclamo','queja','problema','incidencia','falla','sin servicio','cortado'] },
    { name: 'soporte_tecnico', label: 'Soporte Técnico',
      description: 'Asistencia técnica y configuraciones',
      keywords: ['soporte','técnico','configuración','instalación','reparación','ticket','router','fibra','señal','velocidad'] },
    { name: 'instalaciones', label: 'Instalaciones',
      description: 'Nuevas instalaciones y altas de servicio',
      keywords: ['instalación','nueva conexión','alta de servicio','activación','obra','cableado','nodo','ftth'] },
    { name: 'logistica', label: 'Logística',
      description: 'Envíos, stock y materiales',
      keywords: ['logística','envío','entrega','stock','inventario','material','cable','bobina','flete'] },
    { name: 'proveedores', label: 'Proveedores',
      description: 'Comunicaciones con proveedores',
      keywords: ['proveedor','cotización proveedor','insumo','importación','nota de pedido'] },
    { name: 'rrhh', label: 'RRHH',
      description: 'Recursos humanos y personal',
      keywords: ['recursos humanos','liquidación de sueldo','vacaciones','licencia','personal','capacitación'] },
    { name: 'legal', label: 'Legal',
      description: 'Contratos y asuntos jurídicos',
      keywords: ['legal','contrato','intimación','demanda','abogado','resolución','enacom','multa'] },
    { name: 'infraestructura', label: 'Infraestructura',
      description: 'Red, nodos y servidores',
      keywords: ['infraestructura','red','nodo','servidor','switch','firewall','mantenimiento','backbone'] },
    { name: 'facturacion', label: 'Facturación',
      description: 'Emisión de facturas y notas de crédito',
      keywords: ['facturación','nota de crédito','nota de débito','afip','cuit','factura electrónica'] },
    { name: 'atencion_cliente', label: 'Atención al Cliente',
      description: 'Consultas generales y atención postventa',
      keywords: ['atención al cliente','consulta','plan','baja de servicio','cambio de plan','mudanza'] },
    { name: 'marketing', label: 'Marketing',
      description: 'Campañas y comunicaciones de marca',
      keywords: ['marketing','campaña','promoción','publicidad','redes sociales','newsletter'] },
    { name: 'gerencia', label: 'Gerencia',
      description: 'Comunicaciones con dirección y gerencia',
      keywords: ['gerencia','gerente','director','informe ejecutivo','estrategia','kpi','forecast'] },
  ]
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO departments 
    (name, label, description, keywords, account_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction((rows) => {
    for (const d of rows) {
      insert.run(d.name, d.label, d.description, 
                 JSON.stringify(d.keywords), accountId, now)
    }
  })
  tx(depts)
}

module.exports = router