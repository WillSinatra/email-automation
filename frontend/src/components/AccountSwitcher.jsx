import { useState } from 'react'

export default function AccountSwitcher({ 
  accounts, activeId, onSelect, onAdd, onToggle 
}) {
  return (
    <aside className="account-switcher">
      <div className="account-switcher-header">
        <span className="account-switcher-title">Cuentas</span>
        <button className="account-toggle-btn" onClick={onToggle} title="Ocultar panel">
          ✕
        </button>
      </div>

      <ul className="account-list">
        {accounts.map(acc => (
          <li
            key={acc.id}
            className={
              'account-item' + (activeId === acc.id ? ' active' : '')
            }
            onClick={() => onSelect(acc)}
            title={acc.email}
          >
            <span className="account-avatar">
              {acc.email[0].toUpperCase()}
            </span>
            <div className="account-info">
              <span className="account-label">
                {acc.label || acc.email}
              </span>
              <span className="account-host">
                {acc.host}:{acc.port}
              </span>
            </div>
            {acc.is_admin === 1 && (
              <span className="account-admin-badge" title="Cuenta administradora">
                ★
              </span>
            )}
          </li>
        ))}
      </ul>

      {accounts.length < 7 && (
        <button className="add-account-btn" onClick={onAdd}>
          + Agregar cuenta
        </button>
      )}

      {accounts.length >= 7 && (
        <p className="account-limit-msg">
          Límite de 7 cuentas alcanzado
        </p>
      )}
    </aside>
  )
}