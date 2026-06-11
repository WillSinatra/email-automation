import { useState, useEffect, useMemo } from 'react';
import { fetchEmails, getEmails, clearEmails, getEmailById } from '../services/api';
import FilterBar from '../components/FilterBar';
import EmailTable from '../components/EmailTable';
import RulesPanel from '../components/RulesPanel';

export default function DashboardPage({ credentials, onDisconnect }) {
  // Full email list loaded from the database
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Client-side filter state
  const [filterClass, setFilterClass] = useState('all');
  const [filterDomain, setFilterDomain] = useState('');

  // Fetch emails from IMAP action
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Clear database action
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState(null);

  // Load stored emails on mount
  useEffect(() => {
    loadEmails();
  }, []);

  async function loadEmails() {
    setEmailsLoading(true);
    try {
      // Always load all emails; filters are applied client-side
      setEmails(await getEmails());
    } catch (_) {
      // Fail silently — table will show empty state
    } finally {
      setEmailsLoading(false);
    }
  }

  async function handleFetch() {
    setFetchLoading(true);
    setFetchError(null);
    try {
      await fetchEmails(credentials);
      // Automatically refresh the email list after fetching
      await loadEmails();
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetchLoading(false);
    }
  }

  async function handleClear() {
    if (
      !window.confirm(
        'Clear all emails from the database? This cannot be undone.'
      )
    )
      return;
    setClearLoading(true);
    setClearError(null);
    try {
      await clearEmails();
      setEmails([]);
    } catch (err) {
      setClearError(err.message);
    } finally {
      setClearLoading(false);
    }
  }

  async function openEmail(id) {
    setSelectedLoading(true);
    setSelectedEmail(null);
    setSelectedEmailId(id);
    try {
      const data = await getEmailById(id);
      setSelectedEmail(data);
    } catch (err) {
      setSelectedEmail({ error: err.message });
    } finally {
      setSelectedLoading(false);
    }
  }

  function closeEmail() {
    setSelectedEmailId(null);
    setSelectedEmail(null);
  }

  function sanitizeHtml(dirty) {
    if (!dirty) return '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(dirty, 'text/html');
      // Remove dangerous elements
      doc.querySelectorAll('script,style,iframe,object,embed').forEach((e) => e.remove());
      // Allowed attributes
      const allowed = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'class', 'id']);
      doc.querySelectorAll('*').forEach((node) => {
        // Remove event handlers and disallowed attributes
        [...node.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const val = attr.value || '';
          if (name.startsWith('on')) return node.removeAttribute(attr.name);
          if (name === 'src' || name === 'href') {
            if (/^\s*javascript:/i.test(val) || /^\s*data:/i.test(val)) return node.removeAttribute(attr.name);
            return;
          }
          if (!allowed.has(name)) node.removeAttribute(attr.name);
        });
      });
      return doc.body.innerHTML || '';
    } catch (e) {
      return '';
    }
  }

  // All filtering is client-side — no extra API calls on filter change
  const filteredEmails = useMemo(
    () => {
      const normalizedDomainFilter = filterDomain.trim().toLowerCase();
      return emails.filter((e) => {
        if (filterClass !== 'all' && e.classification !== filterClass)
          return false;
        if (
          normalizedDomainFilter &&
          !e.domain?.toLowerCase().includes(normalizedDomainFilter)
        )
          return false;
        return true;
      });
    },
    [emails, filterClass, filterDomain]
  );

  return (
    <div className="dashboard">
      {/* ── Sticky header bar ── */}
      <header className="dash-header">
        <div className="dash-header-info">
          <span className="dash-server">
            {credentials.host}:{credentials.port}
          </span>
          <span className="muted">{credentials.user}</span>
        </div>

        <div className="dash-header-actions">
          {fetchError && <span className="error-msg">{fetchError}</span>}
          <button
            className="btn btn-primary btn-sm"
            onClick={handleFetch}
            disabled={fetchLoading}
          >
            {fetchLoading ? 'Fetching…' : 'Fetch emails'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="dash-content">
        {/* Section 2: Filter controls */}
        <FilterBar
          filterClass={filterClass}
          filterDomain={filterDomain}
          onClassChange={setFilterClass}
          onDomainChange={setFilterDomain}
          onClear={handleClear}
          clearLoading={clearLoading}
          clearError={clearError}
        />

        {/* Section 3: Email table */}
        <EmailTable emails={filteredEmails} loading={emailsLoading} onRowClick={openEmail} />

        {/* Email viewer modal */}
        {selectedEmailId && (
          <div className="modal-overlay" onClick={closeEmail}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <div className="gmail-viewer">
                    <div className="gmail-header">
                      <div className="gmail-subject">{selectedEmail ? selectedEmail.subject : 'Loading…'}</div>
                      <button className="gmail-close" onClick={closeEmail} aria-label="Close">×</button>
                    </div>
                    <div className="gmail-meta">
                      <div className="gmail-from">From: {selectedEmail?.raw_sender || selectedEmail?.sender || '—'}</div>
                      <div className="gmail-date">{selectedEmail?.date ? new Date(selectedEmail.date).toLocaleString() : ''}</div>
                    </div>
                    <div className="gmail-body">
                      {selectedLoading && <p>Loading email…</p>}
                      {selectedEmail && selectedEmail.error && (
                        <p className="error-msg">{selectedEmail.error}</p>
                      )}
                      {selectedEmail && !selectedEmail.error && (
                        <div>
                          {selectedEmail.html ? (
                            <div className="email-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedEmail.html || '') }} />
                          ) : (
                            <pre className="email-body">{selectedEmail.text || '(No body stored)'}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
          </div>
        )}

        {/* Section 4: Collapsible rules panel */}
        <RulesPanel />
      </main>
    </div>
  );
}
