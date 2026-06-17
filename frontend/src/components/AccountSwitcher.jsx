import { useState } from 'react'

export default function AccountSwitcher({ 
  accounts = [], activeId, onSelect, onAdd, onDelete, collapsed, onToggleCollapse 
}) {
  const [hoveredId, setHoveredId] = useState(null)

  if (collapsed) {
    return (
      <div className="account-switcher account-switcher-collapsed">
        <button
          className="account-switcher-expand-btn"
          onClick={onToggleCollapse}
          title="Mostrar cuentas y agregar nueva"
        >
          ☰
        </button>
      </div>
    )
  }

  return (
    <div className="account-switcher">
      <div className="account-switcher-header">
        <div className="account-switcher-brand">
          <img src="/logo-automation.png" alt="Logo" className="account-switcher-logo" />
          <span className="account-switcher-title">Email Automation</span>
        </div>
        <button className="account-switcher-close-btn" onClick={onToggleCollapse} title="Ocultar panel de cuentas">
          ×
        </button>
      </div>

      <ul className="account-list">
        {accounts.map(acc => (
          <li
            key={acc.id}
            className={'account-item' + (activeId === acc.id ? ' active' : '')}
            onClick={() => onSelect(acc)}
            onMouseEnter={() => setHoveredId(acc.id)}
            onMouseLeave={() => setHoveredId(null)}
            title={acc.email}
          >
            <span className="account-avatar">
              {acc.email[0].toUpperCase()}
            </span>
            <div className="account-info">
              <span className="account-label">{acc.label || acc.email}</span>
              <span className="account-host">{acc.host}:{acc.port}</span>
            </div>
            {acc.is_admin === 1 && (
              <span className="account-admin-badge" title="Cuenta administradora">★</span>
            )}
            {hoveredId === acc.id && acc.is_admin !== 1 && (
              <button
                className="account-delete-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(acc)
                }}
                title="Eliminar cuenta"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <button className="add-account-btn" onClick={onAdd}>
        + Agregar cuenta
      </button>

      {accounts.length >= 7 && (
        <p className="account-limit-msg">
          Límite de 7 cuentas alcanzado
        </p>
      )}
    </div>
  )
}