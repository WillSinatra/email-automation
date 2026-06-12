import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchEmails, getFetchStatus, getEmails, clearEmails, getEmailById, getEmailAttachments, getAttachmentUrl, downloadAttachment } from '../services/api';
import FilterBar from '../components/FilterBar';
import EmailTable from '../components/EmailTable';
import RulesPanel from '../components/RulesPanel';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

export default function DashboardPage({ credentials, onDisconnect }) {
  // Full email list loaded from the database
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Client-side filter state
  const [filterClass, setFilterClass] = useState('all');
  const [filterDomain, setFilterDomain] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('2026');

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

  // Read emails state
  const [readEmailIds, setReadEmailIds] = useState(() => {
    try {
      const stored = localStorage.getItem('readEmailIds');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) {
      return new Set();
    }
  });

  const loadingRef = useRef(false);

  const dateRangeText = useMemo(() => {
    const now = new Date();
    const minDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const maxDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const formatOpts = { month: 'long', year: 'numeric' };
    return `Showing emails from ${minDate.toLocaleDateString('en-US', formatOpts)} – ${maxDate.toLocaleDateString('en-US', formatOpts)}`;
  }, []);

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
    if (loadingRef.current) return;
    loadingRef.current = true;
    setEmailsLoading(true);
    try {
      // Always load all emails; filters are applied client-side
      setEmails(await getEmails());
    } catch (_) {
      // Fail silently — table will show empty state
    } finally {
      setEmailsLoading(false);
      loadingRef.current = false;
    }
  }

  async function handleFetch() {
    setFetchLoading(true);
    setFetchError(null);
    setFetchProgress({ fetched: 0, limit: 0, status: 'starting' });
    try {
      const fetchPromise = fetchEmails(credentials, 1500);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Fetch timed out. Try again.')), 30000)
      );
      const resp = await Promise.race([fetchPromise, timeoutPromise]);
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
            // Trigger load without waiting, avoiding stale closures
            loadEmails();
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
    // Mark as read
    setReadEmailIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('readEmailIds', JSON.stringify([...next]));
      return next;
    });

    // Show loading alert
    MySwal.fire({
      title: 'Loading email...',
      didOpen: () => {
        MySwal.showLoading();
      },
      allowOutsideClick: false,
      showConfirmButton: false
    });

    try {
      const data = await getEmailById(id);
      const atts = await getEmailAttachments(id).catch(() => []);
      data.attachments = atts || [];
      
      // Update alert with email content
      MySwal.fire({
        title: data.subject || 'No Subject',
        html: (
          <div className="gmail-viewer-swal" style={{ textAlign: 'left', fontSize: '0.95rem' }}>
            <div className="gmail-meta" style={{ marginBottom: '15px', borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>
              <div className="gmail-from"><strong>From:</strong> {data.raw_sender || data.sender || '—'}</div>
              <div className="gmail-date"><strong>Date:</strong> {data.date ? new Date(data.date).toLocaleString() : ''}</div>
            </div>
            <div className="gmail-body" style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: '5px' }}>
              {data.html ? (
                <div className="email-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.html || '') }} />
              ) : (
                <pre className="email-body" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{data.text || '(No body stored)'}</pre>
              )}

              {data.attachments && data.attachments.length > 0 && (
                <div className="attachments" style={{ marginTop: '20px', borderTop: '1px solid #ddd', paddingTop: '15px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Attachments</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {data.attachments.map((a) => {
                      const ct = (a.content_type || '').toLowerCase();
                      const inlineTypes = ['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff'];
                      const isInline = inlineTypes.includes(ct) || ct.startsWith('image/');
                      return (
                        <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', padding: '8px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e9ecef' }}>
                          <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.filename}</strong>
                          {isInline ? (
                            <a className="btn btn-sm btn-secondary" href={getAttachmentUrl(a.id)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                              View
                            </a>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              style={{ cursor: 'pointer' }}
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
                                  MySwal.fire('Download failed', err && err.message ? err.message : String(err), 'error');
                                }
                              }}
                            >
                              Download
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ),
        width: '850px',
        showCloseButton: true,
        showConfirmButton: false,
        customClass: {
          popup: 'gmail-swal-popup'
        }
      });
    } catch (err) {
      MySwal.fire({
        icon: 'error',
        title: 'Error Loading Email',
        text: err.message
      });
    }
  }

  function closeEmail() {
    // Left for compatibility if any other effect relies on it.
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
      const soporteKeywords = ['reclamo', 'reclamos', 'incidencia', 'queja', 'problema', 'soporte', 'reporte', 'reparacion', 'garantia'];

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
          if (filterClass === 'read') {
            if (!readEmailIds.has(e.id)) return false;
          } else if (filterClass === 'administracion') {
            if (!matchesKeywords(e, adminKeywords)) return false;
          } else if (filterClass === 'soporte_tecnico') {
            if (!matchesKeywords(e, soporteKeywords)) return false;
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
    [emails, filterClass, filterDomain, filterMonth, filterYear, readEmailIds]
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
    }).map(e => ({
      ...e,
      isRead: readEmailIds.has(e.id)
    }));
  }, [filteredEmails, readEmailIds]);

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
        <div className="date-range-info" style={{ marginTop: '-10px', marginBottom: '15px', color: 'var(--muted)', fontSize: '0.9rem' }}>
          {dateRangeText}
        </div>

        {/* Section 3: Email table */}
          <EmailTable emails={sortedEmails} loading={emailsLoading} fetchStarted={fetchLoading || !!fetchJobId} filterClass={filterClass} onRowClick={openEmail} />

        {/* Section 4: Collapsible rules panel */}
        <RulesPanel />
      </main>
    </div>
  );
}
