const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Initialize a local SQLite database file inside /db.
const dbPath = path.join(__dirname, "emails.db");
const db = new Database(dbPath);

// Load and execute SQL schema on startup.
const schemaPath = path.join(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");
db.exec(schemaSql);

// Seed the rules table with example domain rules when empty to make the
// application more discoverable for new users. These are safe defaults
// and can be edited/removed via the UI.
try {
	const countStmt = db.prepare("SELECT COUNT(*) AS c FROM rules");
	const exists = countStmt.get();
	if (exists && exists.c === 0) {
		const insert = db.prepare(
			"INSERT INTO rules (domain, category, created_at) VALUES (?, ?, ?)"
		);
		const now = new Date().toISOString();
		const samples = [
			["mycompany.com", "trusted"],
			["gmail.com", "trusted"],
			["yahoo.com", "trusted"],
			["outlook.com", "trusted"],
			["newsletter.example.com", "ignored"],
			["no-reply.example.com", "ignored"],
			["suspicious-domain.xyz", "spam"],
			["promo.example.com", "spam"],
		];

		const insertMany = db.transaction((rows) => {
			for (const r of rows) insert.run(r[0], r[1], now);
		});

		insertMany(samples);
	}
} catch (err) {
	// If seeding fails, don't crash the app — just log the error.
	console.error('Failed to seed example rules:', err && err.message);
}

// Ensure `body` column exists on `emails` table for storing raw message source.
try {
	const info = db.prepare("PRAGMA table_info(emails)").all();
	const hasBody = info.some((c) => c.name === "body");
	if (!hasBody) {
		db.exec("ALTER TABLE emails ADD COLUMN body TEXT");
	}
} catch (err) {
	console.error('Failed to ensure emails.body column:', err && err.message);
}

// Ensure `text` column exists to store a cleaned plain-text version of the message.
try {
	const info2 = db.prepare("PRAGMA table_info(emails)").all();
	const hasText = info2.some((c) => c.name === "text");
	if (!hasText) {
		db.exec("ALTER TABLE emails ADD COLUMN text TEXT");
	}
} catch (err) {
	console.error('Failed to ensure emails.text column:', err && err.message);
}

	// Ensure `html` column exists to store the decoded HTML part (if present).
	try {
		const info3 = db.prepare("PRAGMA table_info(emails)").all();
		const hasHtml = info3.some((c) => c.name === "html");
		if (!hasHtml) {
			db.exec("ALTER TABLE emails ADD COLUMN html TEXT");
		}
	} catch (err) {
		console.error('Failed to ensure emails.html column:', err && err.message);
	}

// Ensure `is_read` column exists to track read state of emails (0/1).
try {
	const info4 = db.prepare("PRAGMA table_info(emails)").all();
	const hasIsRead = info4.some((c) => c.name === "is_read");
	if (!hasIsRead) {
		db.exec("ALTER TABLE emails ADD COLUMN is_read INTEGER DEFAULT 0");
	}
} catch (err) {
	console.error('Failed to ensure emails.is_read column:', err && err.message);
}

	// Ensure attachments table exists
	try {
		db.exec(`
			CREATE TABLE IF NOT EXISTS attachments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				email_id INTEGER,
				filename TEXT,
				content_type TEXT,
				path TEXT,
				created_at TEXT
			)
		`);
	} catch (err) {
		console.error('Failed to ensure attachments table:', err && err.message);
	}

	// Ensure attachments directory exists
	try {
		const attachDir = path.join(__dirname, 'attachments');
		if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir);
	} catch (err) {
		console.error('Failed to ensure attachments directory:', err && err.message);
	}

// Add content_id to attachments table
try {
  const cols = db.prepare("PRAGMA table_info(attachments)").all();
  if (!cols.some(c => c.name === 'content_id')) {
    db.exec("ALTER TABLE attachments ADD COLUMN content_id TEXT DEFAULT NULL");
    console.log('[db] added content_id column to attachments');
  }
} catch (err) {
  console.error('[db] attachments content_id migration failed:', err.message);
}

// Ensure unique index on emails includes sender+subject+date (recreate if wrong)
try {
  db.exec('DROP INDEX IF EXISTS idx_emails_unique');
  db.exec('DROP INDEX IF EXISTS idx_emails_unique_sender_subject_date');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_unique ON emails (sender, subject, date, account_id)');
  console.log('[db] unique index recreated with account_id');
} catch (err) {
  console.error('[db] unique index migration failed:', err && err.message);
}

// ===== MULTI-ACCOUNT MIGRATIONS =====

// Add account_id column to emails table
try {
  const cols = db.prepare("PRAGMA table_info(emails)").all();
  if (!cols.some(c => c.name === 'account_id')) {
    db.exec("ALTER TABLE emails ADD COLUMN account_id TEXT DEFAULT 'default'");
    console.log('[db] added account_id column to emails');
  }
} catch (err) {
  console.error('[db] account_id migration failed:', err.message);
}

// Add account_id column to departments table
try {
  const cols = db.prepare("PRAGMA table_info(departments)").all();
  if (!cols.some(c => c.name === 'account_id')) {
    db.exec("ALTER TABLE departments ADD COLUMN account_id TEXT DEFAULT 'default'");
    console.log('[db] added account_id column to departments');
  }
} catch (err) {
  console.error('[db] departments account_id migration failed:', err.message);
}

// Create accounts table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      host TEXT NOT NULL DEFAULT 'imap.netlatin.com.ar',
      port INTEGER NOT NULL DEFAULT 993,
      label TEXT,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);
  console.log('[db] accounts table ready');
} catch (err) {
  console.error('[db] accounts table creation failed:', err.message);
}

// Audit log table for tracking connection attempts and security events
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      account_email TEXT,
      ip_address TEXT,
      success INTEGER,
      details TEXT,
      created_at TEXT NOT NULL
    )
  `);
  console.log('[db] audit_log table ready');
} catch (err) {
  console.error('[db] audit_log table creation failed:', err.message);
}

// Add encrypted_password column to accounts table for secure credential storage
try {
  const cols = db.prepare("PRAGMA table_info(accounts)").all();
  if (!cols.some(c => c.name === 'encrypted_password')) {
    db.exec("ALTER TABLE accounts ADD COLUMN encrypted_password TEXT DEFAULT NULL");
    console.log('[db] added encrypted_password column to accounts');
  }
} catch (err) {
  console.error('[db] encrypted_password migration failed:', err.message);
}

// Add secondary_classification column to emails table
try {
  const cols = db.prepare("PRAGMA table_info(emails)").all();
  if (!cols.some(c => c.name === 'secondary_classification')) {
    db.exec("ALTER TABLE emails ADD COLUMN secondary_classification TEXT DEFAULT NULL");
    console.log('[db] added secondary_classification column to emails');
  }
} catch (err) {
  console.error('[db] secondary_classification migration failed:', err.message);
}

// Ensure departments table exists for custom filter categories
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      keywords TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
} catch (err) {
  console.error('Failed to ensure departments table:', err && err.message);
}

// Ensure keywords, description, and color columns exist (migration for existing table)
try {
  const deptInfo = db.prepare("PRAGMA table_info(departments)").all();
  const hasKeywords = deptInfo.some((c) => c.name === "keywords");
  if (!hasKeywords) {
    db.exec("ALTER TABLE departments ADD COLUMN keywords TEXT DEFAULT '[]'");
    console.log('[db] added keywords column to departments');
  }
  const hasDescription = deptInfo.some((c) => c.name === "description");
  if (!hasDescription) {
    db.exec("ALTER TABLE departments ADD COLUMN description TEXT DEFAULT ''");
    console.log('[db] added description column to departments');
  }
  const hasColor = deptInfo.some((c) => c.name === "color");
  if (!hasColor) {
    db.exec("ALTER TABLE departments ADD COLUMN color TEXT DEFAULT NULL");
    console.log('[db] added color column to departments');
  }
} catch (err) {
  console.error('Failed to add columns to departments:', err && err.message);
}

// Seed default departments if table is empty
try {
  const deptCount = db.prepare("SELECT COUNT(*) AS c FROM departments").get();
  if (deptCount && deptCount.c === 0) {
    const insertDept = db.prepare(
      "INSERT INTO departments (name, label, keywords, description, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const now = new Date().toISOString();
    const fiberDepts = [
      {
        name: "ventas",
        label: "Ventas",
        description: "Presupuestos, cotizaciones, propuestas comerciales y consultas de clientes nuevos",
        keywords: ["presupuesto","cotización","cotizacion","propuesta","oferta","pedido","orden de compra","venta","ventas","cliente","contrato","negociación","negociacion","precio","lista de precios","factura de venta","oportunidad","demo","demostración","demostracion","reunión comercial","comercial","licitación","licitacion","descuento","promoción","promocion"]
      },
      {
        name: "administracion",
        label: "Administración",
        description: "Facturas, pagos, recibos, tesorería y gestión contable",
        keywords: ["factura","facturación","facturacion","pago","pagos","recibo","cuenta","administracion","administración","tesoreria","tesorería","finanzas","cobro","cobros","liquidación","liquidacion","balance","presupuesto administrativo","orden de pago","transferencia","cheque","débito","credito","crédito"]
      },
      {
        name: "soporte_tecnico",
        label: "Soporte Técnico",
        description: "Asistencia técnica, reclamos, configuraciones y diagnósticos",
        keywords: ["soporte","técnico","tecnico","asistencia","configuración","configuracion","diagnóstico","diagnostico","instalación","instalacion","reparación","reparacion","ticket","incidente","router","modem","ont","onu","fibra óptica","fibra optica","señal","velocidad","ping","latencia","reconexión","reconexion","reinicio","reset","puerto","ip","dns","reclamo","reclamos","queja","quejas","problema","incidencia","reporte","falla","fallas","inconveniente","disconformidad","insatisfecho","no funciona","sin servicio","cortado","caído","baja de señal","corte","sin internet","sin conexión","sin conexion","no conecta","lentitud","lento","intermitente","inestable"]
      },
      {
        name: "instalaciones",
        label: "Instalaciones",
        description: "Solicitudes y coordinación de nuevas instalaciones de servicio",
        keywords: ["instalación","instalacion","nueva conexión","nueva conexion","alta de servicio","activación","activacion","obra","cableado","tendido","nodo","punto de acceso","acometida","manga","empalme","splitter","patch cord","olt","pon","gpon","epon","ftth","fttb","visita técnica","visita tecnica"]
      },
      {
        name: "logistica",
        label: "Logística",
        description: "Envíos, entregas, stock de materiales y coordinación de equipos",
        keywords: ["logística","logistica","envío","envio","entrega","despacho","remito","stock","inventario","depósito","deposito","almacén","almacen","material","materiales","equipamiento","cable","fibra","bobina","herramienta","herramientas","transporte","camión","camion","flete"]
      },
      {
        name: "proveedores",
        label: "Proveedores",
        description: "Comunicaciones con proveedores de equipos, materiales y servicios",
        keywords: ["proveedor","proveedores","cotización proveedor","orden de compra","insumo","insumos","equipamiento","lote","entrega proveedor","factura proveedor","importación","importacion","aduana","nota de pedido","contrato proveedor","renovación contrato","renovacion contrato"]
      },
      {
        name: "rrhh",
        label: "RRHH",
        description: "Recursos humanos, liquidaciones, vacaciones y comunicados internos",
        keywords: ["recursos humanos","rrhh","liquidación de sueldo","liquidacion de sueldo","recibo de sueldo","vacaciones","licencia","ausencia","personal","empleado","contratación","contratacion","incorporación","incorporacion","baja de empleado","capacitación","capacitacion","entrenamiento","evaluación","evaluacion","desempeño","nómina","nomina"]
      },
      {
        name: "legal",
        label: "Legal",
        description: "Contratos, regulaciones, intimaciones y asuntos jurídicos",
        keywords: ["legal","jurídico","juridico","contrato","intimación","intimacion","demanda","juzgado","abogado","escribano","poder","acta","resolución","resolucion","regulación","regulacion","enacom","ente regulador","habilitación","habilitacion","licencia","concesión","concesion","multa","sanción","sancion","apelación","apelacion"]
      },
      {
        name: "infraestructura",
        label: "Infraestructura",
        description: "Red, nodos, servidores, mantenimiento de infraestructura física",
        keywords: ["infraestructura","red","nodo","nodos","servidor","servidores","datacenter","rack","switch","router","firewall","ups","generador","mantenimiento","preventivo","correctivo","actualización de red","expansión de red","nueva zona","cobertura","backbone","anillo","latencia de red","capacidad","ancho de banda","tráfico"]
      },
      {
        name: "facturacion",
        label: "Facturación",
        description: "Emisión de facturas, notas de crédito y débito a clientes",
        keywords: ["facturación","facturacion","factura","nota de crédito","nota de credito","nota de débito","nota de debito","afip","cuit","iva","monotributo","responsable inscripto","comprobante","ticket","e-factura","factura electrónica","factura electronica","vencimiento","mora","deuda","saldo"]
      },
      {
        name: "atencion_cliente",
        label: "Atención al Cliente",
        description: "Consultas generales, información de planes y atención postventa",
        keywords: ["atención al cliente","atencion al cliente","consulta","información","informacion","plan","planes","servicio","contrato de servicio","baja de servicio","cambio de plan","actualización de plan","domicilio","mudanza","traslado","cobertura","disponibilidad","alta","baja","consulta general"]
      },
      {
        name: "marketing",
        label: "Marketing",
        description: "Campañas, promociones, comunicaciones y estrategia de marca",
        keywords: ["marketing","campaña","campaña publicitaria","promoción","promocion","publicidad","redes sociales","instagram","facebook","contenido","diseño","flyer","banner","newsletter","mailing","pauta","influencer","branding","identidad visual","lanzamiento","evento","feria"]
      },
      {
        name: "gerencia",
        label: "Gerencia",
        description: "Comunicaciones directas con gerencia, directores y accionistas",
        keywords: ["gerencia","gerente","director","directorio","reunión de directorio","accionista","socio","informe ejecutivo","reporte gerencial","decisión estratégica","estrategia","objetivo","meta","kpi","resultado","rendimiento","forecast","proyección","proyeccion"]
      }
    ];

    const insertManyDepts = db.transaction((items) => {
      for (const d of items) {
        insertDept.run(d.name, d.label, JSON.stringify(d.keywords), d.description, now);
      }
    });
    insertManyDepts(fiberDepts);
    console.log(`[database] Seeded ${fiberDepts.length} default departments`);
  }
} catch (err) {
  console.error('Failed to seed departments:', err && err.message);
}

module.exports = db;
