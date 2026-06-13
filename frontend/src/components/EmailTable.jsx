import StatusBadge from './StatusBadge';

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EmailTable({ emails, loading, fetchStarted, filterClass, onRowClick }) {
  // Show the loading state only when a fetch is active AND there are no emails yet.
  // Exception: when the user selected the `ignored` filter, we should not show a persistent
  // "Loading emails..." because ignored messages are intentionally not stored. In that case
  // show the empty-state message instead.
  if (fetchStarted && (!emails || emails.length === 0) && filterClass !== 'ignored') {
    return (
      <div className="email-table-wrapper">
        <p className="empty-state">Loading emails...</p>
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
                      {e.raw_sender || e.sender || '-'}
                    </span>
                  </td>
                  <td className="cell-domain">{e.domain || '-'}</td>
                  <td className="cell-subject" title={e.subject}>
                    {e.subject || '-'}
                  </td>
                  <td className="cell-date">{formatDate(e.date)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
                      <StatusBadge
                        classification={e.displayClassification || e.classification}
                      />
                      {e.secondary_classification && (
                        <StatusBadge classification={e.secondary_classification} />
                      )}
                      {e.showReadBadge && (
                        <StatusBadge classification="read" />
                      )}
                    </span>
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
