const CLASSES = ['all', 'trusted', 'spam', 'ignored', 'ventas', 'administracion', 'soporte_tecnico', 'read'];

export default function FilterBar({
  filterClass,
  filterDomain,
  filterMonth,
  filterYear,
  onClassChange,
  onDomainChange,
  onMonthChange,
  onYearChange,
  onClear,
  clearLoading,
  clearError,
}) {
  return (
    <div className="filter-bar">
      <div className="filter-row">
        {/* Classification radio group */}
        <div className="filter-group">
          <span className="filter-label">Filter:</span>
          <div className="radio-group">
            {CLASSES.map((c) => (
              <label
                key={c}
                className={`radio-label${filterClass === c ? ' active' : ''}`}
              >
                <input
                  type="radio"
                  name="classification"
                  value={c}
                  checked={filterClass === c}
                  onChange={() => onClassChange(c)}
                />
                {(() => {
                  if (c === 'soporte_tecnico') return 'Soporte Técnico';
                  if (c === 'administracion') return 'Administración';
                  if (c === 'ventas') return 'Ventas';
                  return c.charAt(0).toUpperCase() + c.slice(1);
                })()}
              </label>
            ))}
          </div>
        </div>

        {/* Domain text filter (live, client-side) */}
        <div className="filter-group">
          <span className="filter-label">Domain:</span>
          <input
            type="text"
            className="input input-sm"
            style={{ width: 180 }}
            placeholder="Filter by domain…"
            value={filterDomain}
            onChange={(e) => onDomainChange(e.target.value)}
          />
        </div>

        {/* Date filter: month + year */}
        <div className="filter-group">
          <span className="filter-label">Date:</span>
          <select value={filterMonth || ''} onChange={(e) => onMonthChange(e.target.value)} className="input input-sm" style={{width:110}}>
            <option value="">All months</option>
            <option value="4">Apr</option>
            <option value="5">May</option>
            <option value="6">Jun</option>
          </select>
          <select value={filterYear || '2026'} onChange={(e) => onYearChange(e.target.value)} className="input input-sm" style={{width:110, marginLeft:8}}>
            <option value="2026">2026</option>
          </select>
        </div>

        {/* Clear database action */}
        <div className="filter-actions">
          <button
            className="btn btn-danger btn-sm"
            onClick={onClear}
            disabled={clearLoading}
          >
            {clearLoading ? 'Clearing…' : 'Clear database'}
          </button>
          {clearError && <span className="error-msg">{clearError}</span>}
        </div>
      </div>
    </div>
  );
}
