const CLASSES = ['all', 'trusted', 'spam', 'ignored'];

export default function FilterBar({
  filterClass,
  filterDomain,
  onClassChange,
  onDomainChange,
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
                {c.charAt(0).toUpperCase() + c.slice(1)}
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
