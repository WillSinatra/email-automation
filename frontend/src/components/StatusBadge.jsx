export default function StatusBadge({ 
  classification, 
  secondaryClassification 
}) {
  const badgeStyles = {
    trusted: {
      background: 'rgba(67, 209, 122, 0.1)',
      color: '#43d17a',
      border: '1px solid rgba(67, 209, 122, 0.3)'
    },
    spam: {
      background: 'rgba(255, 107, 107, 0.1)',
      color: '#ff6b6b',
      border: '1px solid rgba(255, 107, 107, 0.3)'
    },
    ignored: {
      background: 'rgba(255, 255, 255, 0.08)',
      color: '#ffffff',
      border: '1px solid rgba(255, 255, 255, 0.25)'
    },
    read: {
      background: 'rgba(250, 204, 21, 0.12)',
      color: '#facc15',
      border: '1px solid rgba(250, 204, 21, 0.35)'
    },
    enviado: {
      background: 'rgba(148, 163, 184, 0.12)',
      color: '#94a3b8',
      border: '1px solid rgba(148, 163, 184, 0.35)'
    },
    unread: {
      background: 'rgba(156, 169, 184, 0.1)',
      color: '#9ca9b8',
      border: '1px solid rgba(156, 169, 184, 0.3)'
    },
    administracion: {
      background: 'rgba(6, 182, 212, 0.12)',
      color: '#06b6d4',
      border: '1px solid rgba(6, 182, 212, 0.35)'
    },
    soporte_tecnico: {
      background: 'rgba(37, 99, 235, 0.12)',
      color: '#3b82f6',
      border: '1px solid rgba(37, 99, 235, 0.35)'
    },
    ventas: {
      background: 'rgba(124, 58, 237, 0.12)',
      color: '#7c3aed',
      border: '1px solid rgba(124, 58, 237, 0.35)'
    },
    instalaciones: {
      background: 'rgba(234, 179, 8, 0.12)',
      color: '#eab308',
      border: '1px solid rgba(234, 179, 8, 0.35)'
    },
    logistica: {
      background: 'rgba(249, 115, 22, 0.12)',
      color: '#f97316',
      border: '1px solid rgba(249, 115, 22, 0.35)'
    },
    proveedores: {
      background: 'rgba(20, 184, 166, 0.12)',
      color: '#14b8a6',
      border: '1px solid rgba(20, 184, 166, 0.35)'
    },
    rrhh: {
      background: 'rgba(236, 72, 153, 0.12)',
      color: '#ec4899',
      border: '1px solid rgba(236, 72, 153, 0.35)'
    },
    legal: {
      background: 'rgba(168, 85, 247, 0.12)',
      color: '#a855f7',
      border: '1px solid rgba(168, 85, 247, 0.35)'
    },
    infraestructura: {
      background: 'rgba(100, 116, 139, 0.12)',
      color: '#64748b',
      border: '1px solid rgba(100, 116, 139, 0.35)'
    },
    facturacion: {
      background: 'rgba(16, 185, 129, 0.12)',
      color: '#10b981',
      border: '1px solid rgba(16, 185, 129, 0.35)'
    },
    atencion_cliente: {
      background: 'rgba(59, 130, 246, 0.12)',
      color: '#60a5fa',
      border: '1px solid rgba(59, 130, 246, 0.35)'
    },
    marketing: {
      background: 'rgba(244, 63, 94, 0.12)',
      color: '#f43f5e',
      border: '1px solid rgba(244, 63, 94, 0.35)'
    },
    gerencia: {
      background: 'rgba(251, 191, 36, 0.12)',
      color: '#fbbf24',
      border: '1px solid rgba(251, 191, 36, 0.35)'
    },
  }

  const defaultStyle = {
    background: 'rgba(156, 169, 184, 0.1)',
    color: '#9ca9b8',
    border: '1px solid rgba(156, 169, 184, 0.3)'
  }

  const pillStyle = {
    padding: '2px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
    whiteSpace: 'nowrap',
  }

  function getLabel(key) {
    return key
      ? key.replace(/_/g, ' ')
           .replace(/\b\w/g, c => c.toUpperCase())
      : 'Unknown'
  }

  const primaryStyle = badgeStyles[classification] || defaultStyle
  const secondaryStyle = secondaryClassification
    ? badgeStyles[secondaryClassification] || defaultStyle
    : null

  return (
    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
      <span style={{ ...pillStyle, ...primaryStyle }}>
        {getLabel(classification)}
      </span>
      {secondaryStyle && (
        <span style={{ ...pillStyle, ...secondaryStyle }}>
          {getLabel(secondaryClassification)}
        </span>
      )}
    </span>
  )
}