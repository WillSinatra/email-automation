import StatusBadge from './StatusBadge';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EmailTable({ emails, loading, onRowClick }) {
  if (loading) {
    return (
      <div className="email-table-wrapper">
        <p className="empty-state">Loading emails…</p>
      </div>
    );
  }

  return (
    <div className="email-table-wrapper">
      <div className="table-count">
        Showing <strong>{emails.length}</strong>{' '}
        email{emails.length !== 1 ? 's' : ''}
      </div>

      {emails.length === 0 ? (
        <p className="empty-state">No emails match the current filter.</p>
      ) : (
        <div className="table-overflow">
          <table className="email-table">
            <thead>
              <tr>
                <th>Sender</th>
                <th>Domain</th>
                <th>Subject</th>
                <th>Date</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id} style={{ cursor: onRowClick ? 'default' : 'default' }}>
                  <td className="cell-sender" title={e.raw_sender || e.sender}>
                    <span
                      className="sender-link"
                      role="button"
                      tabIndex={0}
                      onClick={(ev) => { ev.stopPropagation(); onRowClick && onRowClick(e.id); }}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onRowClick && onRowClick(e.id); } }}
                      style={{ background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer' }}
                    >
                      {e.raw_sender || e.sender || '—'}
                    </span>
                  </td>
                  <td className="cell-domain">{e.domain || '—'}</td>
                  <td className="cell-subject" title={e.subject}>
                    {e.subject || '—'}
                  </td>
                  <td className="cell-date">{formatDate(e.date)}</td>
                  <td>
                    <StatusBadge value={e.classification} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
