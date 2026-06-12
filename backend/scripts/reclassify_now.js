const db = require('../db/database');

try {
  console.log('Starting retroactive reclassification...');

  // 1) Move to 'ignored' based on subject prefixes, newsletter keywords or sender name
  const ignoredUpdate = db.prepare(`
    UPDATE emails SET classification = 'ignored'
    WHERE classification != 'ignored' AND (
      lower(subject) LIKE 'cursos%' OR
      lower(subject) LIKE 'taller%' OR
      lower(subject) LIKE '%newsletter%' OR
      lower(raw_sender) LIKE '%newsletter%' OR
      lower(domain) LIKE '%newsletter%' OR
      lower(raw_sender) LIKE '%soluciones it aps%'
    )
  `);
  const ignoredInfo = ignoredUpdate.run();
  console.log('Ignored updated rows:', ignoredInfo.changes || 0);

  // 2) Reclassify remaining 'spam' to administracion/soporte_tecnico based on keywords
  const adminKeywords = ['factura','facturación','facturacion','pago','pagos','recibo','cuenta','administracion','administración','tesoreria','tesorería','finanzas','cobro'];
  const soporteKeywords = ['reclamo','reclamos','incidencia','queja','problema','soporte','reporte','reparacion','reparación','garantia','garantía'];
  const ventasKeywords = [
    'presupuesto','presupuestos','cotización','cotizacion','cotizaciones','propuesta','propuestas','oferta','ofertas','pedido','pedidos','orden de compra','ordenes de compra','venta','ventas','cliente','clientes','contrato','contratos','negociación','negociacion','producto','productos','servicio','servicios','precio','precios','lista de precios','factura de venta','oportunidad','oportunidades','demo','demostración','demostracion','reunión comercial','reunion comercial','comercial','propuesta comercial','licitación','licitacion','descuento','descuentos','promoción','promocion'
  ];

  const spamRows = db.prepare("SELECT id, subject, sender, raw_sender, coalesce(text,'') as text, domain FROM emails WHERE classification = 'spam'").all();
  console.log('Spam rows scanned:', spamRows.length);

  const updateStmt = db.prepare("UPDATE emails SET classification = ? WHERE id = ?");
  let adminCount = 0, soporteCount = 0, ventasCount = 0;

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const txt = `${r.subject || ''} ${r.sender || ''} ${r.raw_sender || ''} ${r.text || ''} ${r.domain || ''}`.toLowerCase();
      const isAdmin = adminKeywords.some(k => txt.includes(k));
      const isReclamo = soporteKeywords.some(k => txt.includes(k));
      const isVenta = ventasKeywords.some(k => txt.includes(k));
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

  console.log('Reclassified to administracion:', adminCount);
  console.log('Reclassified to soporte_tecnico:', soporteCount);
  console.log('Reclassified to ventas:', ventasCount);

  console.log('Done.');
} catch (err) {
  console.error('Error during reclassification:', err && err.message);
  process.exitCode = 1;
}
