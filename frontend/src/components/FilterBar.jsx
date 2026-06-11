const CLASSES = ['all', 'trusted', 'spam', 'ignored', 'administracion', 'reclamos'];

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

        {/* Date filter: month + year */}
        <div className="filter-group">
          <span className="filter-label">Date:</span>
          <select value={filterMonth || ''} onChange={(e) => onMonthChange(e.target.value)} className="input input-sm" style={{width:110}}>
            <option value="">All months</option>
            <option value="1">Jan</option>
            <option value="2">Feb</option>
            <option value="3">Mar</option>
            <option value="4">Apr</option>
            <option value="5">May</option>
            <option value="6">Jun</option>
            <option value="7">Jul</option>
            <option value="8">Aug</option>
            <option value="9">Sep</option>
            <option value="10">Oct</option>
            <option value="11">Nov</option>
            <option value="12">Dec</option>
          </select>
          <select value={filterYear || ''} onChange={(e) => onYearChange(e.target.value)} className="input input-sm" style={{width:110, marginLeft:8}}>
            <option value="">All years</option>
            {(() => {
              // Use UTC year to match stored email dates (stored as ISO UTC)
              const cur = new Date().getUTCFullYear();
              const years = [];
              for (let y = cur; y >= cur - 10; y--) years.push(y);
              return years.map((y) => <option key={y} value={String(y)}>{y}</option>);
            })()}
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
