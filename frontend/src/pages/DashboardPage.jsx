import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchEmails, startFetchEmails, getFetchStatus, getEmails, clearEmails, getEmailById, getEmailAttachments, getAttachmentUrl, downloadAttachment } from '../services/api';
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
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');

  // Fetch emails from IMAP action
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [fetchJobId, setFetchJobId] = useState(null);
  const [fetchProgress, setFetchProgress] = useState(null);
  const fetchPollRef = useRef(null);
  const prevFetchedRef = useRef(0);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Clear database action
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState(null);

  // Load stored emails on mount
  useEffect(() => {
    loadEmails();
    return () => {
      if (fetchPollRef.current) {
        clearInterval(fetchPollRef.current);
        fetchPollRef.current = null;
      }
    };
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
    setFetchProgress({ fetched: 0, limit: 0, status: 'starting' });
    try {
      const resp = await startFetchEmails(credentials, 1500);
      const jobId = resp.jobId;
      setFetchJobId(jobId);
      // poll status
      fetchPollRef.current = setInterval(async () => {
        try {
          const st = await getFetchStatus(jobId);
          setFetchProgress(st);
          // If we've fetched any new messages since last check, refresh the inbox so user sees messages progressively
          const prev = prevFetchedRef.current || 0;
          const fetched = st.fetched || 0;
          if (fetched > prev) {
            prevFetchedRef.current = fetched;
            // avoid concurrent loads
            if (!emailsLoading) await loadEmails();
          }

          if (st.status === 'done' || st.status === 'failed') {
            clearInterval(fetchPollRef.current);
            fetchPollRef.current = null;
            setFetchJobId(null);
            setFetchLoading(false);
            if (st.status === 'done') {
              await loadEmails();
            } else {
              setFetchError(st.lastError || 'Fetch failed');
            }
          }
        } catch (e) {
          // If the job is not found on the server (404), stop polling and show a clear error.
          const msg = e && e.message ? String(e.message).toLowerCase() : '';
          if (msg.includes('job not found') || msg.includes('404')) {
            clearInterval(fetchPollRef.current);
            fetchPollRef.current = null;
            setFetchJobId(null);
            setFetchLoading(false);
            setFetchError('Fetch job not found on server (server may have restarted).');
            // reload current emails in case the DB already has rows
            try { if (!emailsLoading) await loadEmails(); } catch (_) {}
            return;
          }
          // ignore other transient polling errors
        }
      }, 1000);
    } catch (err) {
      setFetchError(err.message);
      setFetchLoading(false);
      setFetchProgress(null);
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
      const atts = await getEmailAttachments(id).catch(() => []);
      data.attachments = atts || [];
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
      // keyword-based detectors for new filters
      const adminKeywords = ['factura', 'facturación', 'pago', 'pagos', 'recibo', 'cuenta', 'administracion', 'administración', 'tesoreria', 'tesorería', 'finanzas', 'cobro'];
      const reclamosKeywords = ['reclamo', 'reclamos', 'incidencia', 'queja', 'problema', 'soporte', 'reporte', 'reparacion', 'garantia'];

      function textForMatch(email) {
        const parts = [email.subject, email.sender, email.raw_sender, email.domain, email.text];
        return parts.filter(Boolean).join(' ').toLowerCase();
      }

      function matchesKeywords(email, keywords) {
        const txt = textForMatch(email);
        return keywords.some((k) => txt.includes(k));
      }

      return emails.filter((e) => {
        // handle classification-like filters
        if (filterClass !== 'all') {
          if (filterClass === 'administracion') {
            if (!matchesKeywords(e, adminKeywords)) return false;
          } else if (filterClass === 'reclamos') {
            if (!matchesKeywords(e, reclamosKeywords)) return false;
          } else {
            if (e.classification !== filterClass) return false;
          }
        }
        if (
          normalizedDomainFilter &&
          !e.domain?.toLowerCase().includes(normalizedDomainFilter)
        )
          return false;
        // date filter: filterMonth (1-12) and filterYear (YYYY) if provided
        if (filterYear) {
          if (!e.date) return false;
          const dt = new Date(e.date);
          if (isNaN(dt.getTime())) return false;
          if (String(dt.getUTCFullYear()) !== String(filterYear)) return false;
          if (filterMonth) {
            const m = dt.getUTCMonth() + 1; // 1-12 (UTC)
            if (String(m) !== String(filterMonth)) return false;
          }
        } else if (filterMonth) {
          // month selected but no year: match month across any year
          if (!e.date) return false;
          const dt = new Date(e.date);
          if (isNaN(dt.getTime())) return false;
          const m = dt.getUTCMonth() + 1;
          if (String(m) !== String(filterMonth)) return false;
        }
        return true;
      });
    },
    [emails, filterClass, filterDomain, filterMonth, filterYear]
  );

  const sortedEmails = useMemo(() => {
    const today = new Date();
    // Use UTC-based year/month/day to avoid timezone-induced year shifts
    const curYear = today.getUTCFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    const todayYMD = `${curYear}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
    const getYMD = (dateStr) => {
      if (!dateStr) return null;
      const dt = new Date(dateStr);
      if (isNaN(dt.getTime())) return null;
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    };

    return [...filteredEmails].sort((a, b) => {
      const aYmd = getYMD(a.date);
      const bYmd = getYMD(b.date);
      // today first
      if (aYmd === todayYMD && bYmd !== todayYMD) return -1;
      if (bYmd === todayYMD && aYmd !== todayYMD) return 1;
      // current year next
      const aYear = a.date ? new Date(a.date).getUTCFullYear() : null;
      const bYear = b.date ? new Date(b.date).getUTCFullYear() : null;
      if (aYear === curYear && bYear !== curYear) return -1;
      if (bYear === curYear && aYear !== curYear) return 1;
      // otherwise sort by date desc (newest first)
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });
  }, [filteredEmails]);

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
          {fetchProgress && (
            <div style={{display:'flex', alignItems:'center', gap:8, marginRight:8}}>
              <div style={{width:200, height:10, background:'#222', borderRadius:6, overflow:'hidden'}}>
                <div style={{width: `${fetchProgress.percent || 0}%`, height: '100%', background:'#2ea44f'}} />
              </div>
              <div className="muted" style={{fontSize:'0.85rem'}}>
                {fetchProgress.fetched || 0}/{fetchProgress.limit || '∞'} ({fetchProgress.percent || 0}%)
                {fetchProgress.totalBatches ? ` — lote ${fetchProgress.currentBatch || 0}/${fetchProgress.totalBatches}` : ''}
              </div>
            </div>
          )}
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
          filterMonth={filterMonth}
          filterYear={filterYear}
          onClassChange={setFilterClass}
          onDomainChange={setFilterDomain}
          onMonthChange={setFilterMonth}
          onYearChange={setFilterYear}
          onClear={handleClear}
          clearLoading={clearLoading}
          clearError={clearError}
        />

        {/* Section 3: Email table */}
          <EmailTable emails={sortedEmails} loading={emailsLoading} fetchStarted={fetchLoading || !!fetchJobId} filterClass={filterClass} onRowClick={openEmail} />

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

                          {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                            <div className="attachments">
                              <h4>Attachments</h4>
                              <ul>
                                {selectedEmail.attachments.map((a) => {
                                  const ct = (a.content_type || '').toLowerCase();
                                  const inlineTypes = ['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff'];
                                  const isInline = inlineTypes.includes(ct) || ct.startsWith('image/');
                                  return (
                                    <li key={a.id}>
                                      <strong>{a.filename}</strong> — {a.content_type} {' '}
                                      {isInline ? (
                                        <a className="btn btn-sm btn-secondary" href={getAttachmentUrl(a.id)} target="_blank" rel="noopener noreferrer">
                                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style={{verticalAlign:'middle', marginRight:6}} aria-hidden>
                                            <path fill="currentColor" d="M12 5c-1.1 0-2 .9-2 2v6H7l5 5 5-5h-3V7c0-1.1-.9-2-2-2z"/>
                                          </svg>
                                          View
                                        </a>
                                      ) : (
                                        <a
                                          className="btn btn-sm btn-primary"
                                          href={getAttachmentUrl(a.id)}
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            try {
                                              const blob = await downloadAttachment(a.id);
                                              const url = URL.createObjectURL(blob);
                                              const link = document.createElement('a');
                                              link.href = url;
                                              link.download = a.filename || 'attachment';
                                              document.body.appendChild(link);
                                              link.click();
                                              link.remove();
                                              setTimeout(() => URL.revokeObjectURL(url), 60000);
                                            } catch (err) {
                                              alert('Download failed: ' + (err && err.message ? err.message : String(err)));
                                            }
                                          }}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style={{verticalAlign:'middle', marginRight:6}} aria-hidden>
                                            <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18L5.33 9h3.67v6h6V9h3.67L12 2z"/>
                                          </svg>
                                          Download
                                        </a>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
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
