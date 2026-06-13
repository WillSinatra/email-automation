import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchEmails, getFetchStatus, getEmails, clearEmails, getEmailById, getEmailAttachments, getAttachmentUrl, downloadAttachment, getDepartments, getEmailCounts, reclassifySpam, getDateRange, markAsRead } from '../services/api';
import FilterBar from '../components/FilterBar';
import EmailTable from '../components/EmailTable';
import RulesPanel from '../components/RulesPanel';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

export default function DashboardPage({ credentials, account, onDisconnect, showAccountPanel, onToggleAccountPanel }) {
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
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const fetchPollRef = useRef(null);
  const prevFetchedRef = useRef(0);

  // Auto-refresh notification with 30s auto-close
  const AUTO_CLOSE_MS = 30000;
  const [refreshNotif, setRefreshNotif] = useState(null);
  const refreshNotifTimer = useRef(null);

  function showRefreshNotif(message) {
    if (refreshNotifTimer.current) {
      clearTimeout(refreshNotifTimer.current);
    }
    setRefreshNotif({ message, startedAt: Date.now() });
    refreshNotifTimer.current = setTimeout(() => {
      setRefreshNotif(null);
    }, AUTO_CLOSE_MS);
  }

  function closeRefreshNotif() {
    if (refreshNotifTimer.current) {
      clearTimeout(refreshNotifTimer.current);
    }
    setRefreshNotif(null);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshNotifTimer.current) {
        clearTimeout(refreshNotifTimer.current);
      }
    };
  }, []);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Clear database action
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState(null);

  // Email counts per classification
  const [emailCounts, setEmailCounts] = useState({});

  // Reclassify spam state
  const [reclassifyLoading, setReclassifyLoading] = useState(false);
  const [reclassifyMessage, setReclassifyMessage] = useState(null);
  const [reclassifyResult, setReclassifyResult] = useState(null);

  // Custom departments from the server
  const [departments, setDepartments] = useState([]);

  // Date range label from the server
  const [dateRangeLabel, setDateRangeLabel] = useState('');

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

  const accountId = credentials?.account_id;

  // Load departments (only when credentials exist)
  async function loadDepartments() {
    if (!credentials) return;
    try {
      setDepartments(await getDepartments(accountId));
    } catch (err) {
      console.error('departments failed:', err && err.message);
    }
  }

  // Load counts (only when credentials exist)
  async function loadCounts() {
    if (!credentials) return;
    try {
      setEmailCounts(await getEmailCounts(accountId));
    } catch (err) {
      console.error('counts failed:', err && err.message);
    }
  }

  async function handleReclassify() {
    setReclassifyLoading(true);
    setReclassifyMessage(null);
    setReclassifyResult(null);
    try {
      const result = await reclassifySpam();
      setReclassifyResult(result);
      await loadEmails();
      await loadCounts();
    } catch (err) {
      setReclassifyResult({ error: err.message });
    } finally {
      setReclassifyLoading(false);
    }
  }

  // Load date range on mount
  useEffect(() => {
    getDateRange()
      .then(r => setDateRangeLabel(r.label))
      .catch(() => {});
  }, []);

  // Load departments on mount (with credentials guard)
  useEffect(() => {
    if (!credentials) return;
    loadDepartments();
  }, [credentials]);

  // Load counts on mount and refresh every 30 seconds (with credentials guard)
  useEffect(() => {
    if (!credentials) return;
    const load = () => {
      getEmailCounts(accountId)
        .then(setEmailCounts)
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [credentials]);

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
      setEmails(await getEmails(undefined, accountId));
    } catch (_) {
      // Fail silently - table will show empty state
    } finally {
      setEmailsLoading(false);
      loadingRef.current = false;
    }
  }

  async function pollFetchJob(jobId) {
    return new Promise((resolve) => {
      fetchPollRef.current = setInterval(async () => {
        try {
          const st = await getFetchStatus(jobId);
          setFetchProgress(st);

          if (st.status === 'done' || st.status === 'failed') {
            clearInterval(fetchPollRef.current);
            fetchPollRef.current = null;
            setFetchJobId(null);
            if (st.status === 'done') {
              const summary = `✓ Fetch completo: ${st.saved || 0} guardados, ${st.skipped || 0} duplicados omitidos`;
              setFetchProgress({ ...st, summary });
            } else {
              setFetchError(st.lastError || 'Fetch failed');
            }
            resolve(st);
          }
        } catch (e) {
          const msg = e && e.message ? String(e.message).toLowerCase() : '';
          if (msg.includes('job not found') || msg.includes('404')) {
            clearInterval(fetchPollRef.current);
            fetchPollRef.current = null;
            setFetchJobId(null);
            setFetchLoading(false);
            setFetchError('Fetch job not found on server (server may have restarted).');
            resolve(null);
            return;
          }
        }
      }, 2000);
    });
  }

  async function handleFetch() {
    setFetchLoading(true);
    setFetchError(null);
    setFetchProgress({ fetched: 0, limit: 1500, status: 'starting' });
    try {
      const resp = await fetchEmails(credentials, 1500);
      const jobId = resp.jobId;
      setFetchJobId(jobId);
      const result = await pollFetchJob(jobId);
      setFetchLoading(false);
      if (result && result.status === 'done') {
        await loadEmails();
        await loadCounts();
        // Refresh the date range label after fetch
        try {
          const range = await getDateRange();
          setDateRangeLabel(range.label);
        } catch (_) {}
      }
    } catch (err) {
      setFetchError(err.message);
      setFetchLoading(false);
      setFetchProgress(null);
    }
  }

  async function handleAutoRefresh() {
    if (fetchLoading || fetchJobId || autoRefreshing) return;
    setAutoRefreshing(true);
    try {
      const resp = await fetchEmails(credentials, 1500);
      const jobId = resp.jobId;
      // Small inline poll for auto-refresh
      const done = await new Promise((resolve) => {
        const poll = setInterval(async () => {
          try {
            const st = await getFetchStatus(jobId);
            if (st.status === 'done' || st.status === 'failed') {
              clearInterval(poll);
              resolve(st.status === 'done' ? st : null);
            }
          } catch (_) {}
        }, 2000);
      });
      if (done) {
        await loadEmails();
        await loadCounts();
        await handleReclassify();
        const savedCount = done.saved || 0;
        showRefreshNotif(
          `🔄 Actualización completada — ${savedCount} correos nuevos cargados`
        );
      }
    } catch (err) {
      console.error('[autoRefresh] failed:', err.message);
    } finally {
      setAutoRefreshing(false);
    }
  }

  // Auto-refresh every 10 minutes
  const isFetching = fetchLoading || !!fetchJobId;
  useEffect(() => {
    if (!credentials) return;
    const interval = setInterval(() => {
      if (!isFetching) {
        handleAutoRefresh();
      }
    }, 600000);
    return () => clearInterval(interval);
  }, [credentials, isFetching]);

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
      await clearEmails(accountId);
      setEmails([]);
    } catch (err) {
      setClearError(err.message);
    } finally {
      setClearLoading(false);
    }
  }

  async function openEmail(id) {
    // Mark as read via API and update local state immediately
    try {
      await markAsRead(id);
      setEmails(prev => prev.map(e =>
        e.id === id
          ? { ...e, is_read: 1, classification: 'read' }
          : e
      ));
    } catch (err) {
      console.error('markAsRead failed:', err.message);
    }

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
      const data = await getEmailById(id, accountId);
      const atts = await getEmailAttachments(id).catch(() => []);
      data.attachments = atts || [];
      
      // Update alert with email content
      MySwal.fire({
        title: data.subject || 'No Subject',
        html: (
          <div className="gmail-viewer-swal" style={{ textAlign: 'left', fontSize: '0.95rem' }}>
            <div className="gmail-meta" style={{ marginBottom: '15px', borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>
              <div className="gmail-from"><strong>From:</strong> {data.raw_sender || data.sender || '-'}</div>
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
      // Step 1: Decode quoted-printable artifacts (e.g. =0A, =3D, =20) that may remain in the text
      let clean = String(dirty);
      // Decode common quoted-printable escape sequences before parsing
      clean = clean.replace(/=0A/gi, '\n');
      clean = clean.replace(/=0D/gi, '\r');
      clean = clean.replace(/=09/gi, '\t');
      clean = clean.replace(/=20/gi, ' ');
      clean = clean.replace(/=3D/gi, '=');
      clean = clean.replace(/=2C/gi, ',');
      clean = clean.replace(/=22/gi, '"');
      clean = clean.replace(/=27/gi, "'");
      clean = clean.replace(/=28/gi, '(');
      clean = clean.replace(/=29/gi, ')');
      clean = clean.replace(/=3C/gi, '<');
      clean = clean.replace(/=3E/gi, '>');
      clean = clean.replace(/=40/gi, '@');
      clean = clean.replace(/=2F/gi, '/');
      clean = clean.replace(/=3A/gi, ':');
      clean = clean.replace(/=3B/gi, ';');
      // Catch any remaining =XX sequences (standalone ones that weren't part of HTML entities)
      clean = clean.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
        const code = parseInt(hex, 16);
        // Decode printable ASCII (0x20-0x7E) and common line breaks
        if (code === 0x0A) return '\n';
        if (code === 0x0D) return '\r';
        if (code === 0x09) return '\t';
        if (code >= 0x20 && code <= 0x7E) return String.fromCharCode(code);
        // For multi-byte UTF-8 sequences, keep the raw bytes pattern
        return `=${hex}`;
      });
      // Remove soft line breaks (=\r\n or =\n) that are quoted-printable line continuations
      clean = clean.replace(/=\r?\n/g, '');

      const parser = new DOMParser();
      const doc = parser.parseFromString(clean, 'text/html');
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

      // Replace cid: images with a placeholder message
      doc.querySelectorAll('img[src^="cid:"]').forEach((img) => {
        const placeholder = doc.createElement('div');
        placeholder.className = 'email-image-blocked';
        placeholder.innerHTML = '<span class="email-image-blocked-icon">🖼️</span><span class="email-image-blocked-text">Image not available: this image is embedded in the email and cannot be displayed externally.</span>';
        img.parentNode.replaceChild(placeholder, img);
      });

      // For external images, add an onerror handler to show a placeholder if the image fails to load
      doc.querySelectorAll('img').forEach((img) => {
        // Skip if already replaced or data URI
        if (!img.getAttribute('src') || img.getAttribute('src').startsWith('data:')) return;
        // Check if it looks like an external image URL (http/https)
        const src = img.getAttribute('src');
        if (src.startsWith('http://') || src.startsWith('https://')) {
          img.setAttribute('onerror', "this.onerror=null; this.outerHTML='<div class=\"email-image-blocked\"><span class=\"email-image-blocked-icon\">🚫</span><span class=\"email-image-blocked-text\">Image blocked: the external image could not be loaded. Webmail protection may have prevented access.</span></div>';");
        } else if (src.startsWith('//')) {
          // Protocol-relative URL
          img.setAttribute('onerror', "this.onerror=null; this.outerHTML='<div class=\"email-image-blocked\"><span class=\"email-image-blocked-icon\">🚫</span><span class=\"email-image-blocked-text\">Image blocked: the external image could not be loaded. Webmail protection may have prevented access.</span></div>';");
        }
      });

      return doc.body.innerHTML || '';
    } catch (e) {
      return '';
    }
  }

  // All filtering is client-side - no extra API calls on filter change
  const filteredEmails = useMemo(
    () => {
      const normalizedDomainFilter = filterDomain.trim().toLowerCase();
      // keyword-based detectors for new filters
      const adminKeywords = ['factura', 'facturacion', 'pago', 'pagos', 'recibo', 'cuenta', 'administracion', 'tesoreria', 'finanzas', 'cobro'];
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

  function buildReclassifyLines(result) {
    if (!result || result.error) return { lines: [], total: 0 };

    const labelMap = {
      adminCount:         'Administración',
      soporteCount:       'Soporte Técnico',
      ventasCount:        'Ventas',
      instalacionesCount: 'Instalaciones',
      logisticaCount:     'Logística',
      proveedoresCount:   'Proveedores',
      rrhhCount:          'RRHH',
      legalCount:         'Legal',
      infraestructuraCount: 'Infraestructura',
      facturacionCount:   'Facturación',
      atencionClienteCount: 'Atención al Cliente',
      marketingCount:     'Marketing',
      gerenciaCount:      'Gerencia',
    };

    const lines = [];
    let total = 0;
    for (const [key, val] of Object.entries(result)) {
      if (key !== 'scanned' && val > 0) {
        const label = labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
        lines.push({ label, count: val });
        total += val;
      }
    }
    return { lines, total };
  }

  function ReclassifyResultPanel({ result, onClose }) {
    const [visible, setVisible] = useState(true);
    const { lines, total } = buildReclassifyLines(result);

    useEffect(() => {
      const timer = setTimeout(() => setVisible(false), 10000);
      return () => clearTimeout(timer);
    }, []);

    if (!visible || !result) return null;

    if (result.error) {
      return (
        <div className="reclassify-result-panel" style={{ borderColor: 'rgba(240,80,80,0.25)', background: 'rgba(240,80,80,0.07)' }}>
          <span className="reclassify-ok" style={{ color: '#f05050' }}>✗</span>
          Error: {result.error}
          <button className="reclassify-close" onClick={onClose}>×</button>
        </div>
      );
    }

    if (lines.length === 0) {
      return (
        <div className="reclassify-result-panel">
          <span className="reclassify-ok">✓</span>
          Todo está al día. No se encontraron correos nuevos para organizar.
          <button className="reclassify-close" onClick={onClose}>×</button>
        </div>
      );
    }

    if (lines.length === 1) {
      return (
        <div className="reclassify-result-panel">
          <span className="reclassify-ok">✓</span>
          Se organizaron {lines[0].count} correos de {lines[0].label} automáticamente.
          <button className="reclassify-close" onClick={onClose}>×</button>
        </div>
      );
    }

    return (
      <div className="reclassify-result-panel">
        <div className="reclassify-header">
          <span className="reclassify-ok">✓</span>
          Tus correos fueron organizados automáticamente.
          <button className="reclassify-close" onClick={onClose}>×</button>
        </div>
        <ul className="reclassify-list">
          {lines.map(({ label, count }) => (
            <li key={label}>· {count} correos de {label}</li>
          ))}
        </ul>
        <div className="reclassify-total">
          Total: {total} correos organizados
        </div>
      </div>
    );
  }

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

  function AutoRefreshNotif({ message, startedAt, durationMs, onClose }) {
    const [progress, setProgress] = useState(100);

    useEffect(() => {
      const interval = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
        setProgress(remaining);
        if (remaining === 0) clearInterval(interval);
      }, 300);
      return () => clearInterval(interval);
    }, [startedAt, durationMs]);

    return (
      <div className="auto-refresh-notif">
        <div className="auto-refresh-notif-content">
          <span>{message}</span>
          <button
            className="auto-refresh-notif-close"
            onClick={onClose}
            title="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="auto-refresh-notif-bar">
          <div
            className="auto-refresh-notif-progress"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Sticky header bar */}
      <header className="dash-header">
        <div className="dash-header-info">
          <span className="dash-server">
            {credentials.host}:{credentials.port}
          </span>
          <span className="muted">{credentials.user}</span>
        </div>

        <div className="dash-header-actions">
          <button
            className="btn btn-secondary btn-sm account-panel-toggle"
            onClick={onToggleAccountPanel}
            title={showAccountPanel ? 'Ocultar cuentas' : 'Mostrar cuentas'}
          >
            {showAccountPanel ? '◀' : '▶'} Cuentas
          </button>
          {fetchError && <span className="error-msg">{fetchError}</span>}
          {reclassifyMessage && <span className="reclassify-msg">{reclassifyMessage}</span>}
          {autoRefreshing && <span className="auto-refresh-msg">🔄 Actualizando...</span>}
          {fetchProgress && fetchProgress.status !== 'done' && (
            <div style={{display:'flex', alignItems:'center', gap:8, marginRight:8}}>
              <div style={{width:200, height:10, background:'#222', borderRadius:6, overflow:'hidden'}}>
                <div style={{width: `${fetchProgress.percent || 0}%`, height: '100%', background:'#2ea44f'}} />
              </div>
              <div className="muted" style={{fontSize:'0.85rem', whiteSpace:'nowrap'}}>
                Procesando lote {fetchProgress.currentBatch || 0}/{fetchProgress.totalBatches || 30} — {fetchProgress.fetched || 0} correos ({fetchProgress.percent || 0}%)
              </div>
            </div>
          )}
          {fetchProgress && fetchProgress.summary && (
            <span className="reclassify-msg">{fetchProgress.summary}</span>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={handleFetch}
            disabled={fetchLoading}
          >
            {fetchLoading ? 'Fetching...' : 'Fetch emails'}
          </button>
          <span className="date-range-label">
            📅 Correos de {dateRangeLabel}
          </span>
          <button
            className="btn btn-accent btn-sm"
            onClick={handleReclassify}
            disabled={reclassifyLoading}
            title="Organiza automáticamente los correos spam según los departamentos configurados"
          >
            {reclassifyLoading ? 'Reclasificando...' : 'Reclasificar'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Main content */}
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
          departments={departments}
          onDepartmentsChange={loadDepartments}
          counts={emailCounts}
          accountId={accountId}
        />

        {/* Onboarding banner for first-time users */}
        {emails.length === 0 && !emailsLoading && !fetchLoading && !fetchJobId && (
          <div className="onboarding-banner">
            <div className="onboarding-banner-icon">👋</div>
            <div className="onboarding-banner-content">
              <h3>Bienvenido a la herramienta de automatización de correos</h3>
              <ol>
                <li>Asegurate de estar conectado al servidor de correo</li>
                <li>Hacé clic en <strong>'Fetch Emails'</strong> para traer tus correos</li>
                <li>Usá los filtros de arriba para ver correos por departamento</li>
                <li>Hacé clic en <strong>'Reclasificar'</strong> para organizar automáticamente</li>
              </ol>
            </div>
          </div>
        )}

        {/* Reclassify result panel */}
        {reclassifyResult && (
          <ReclassifyResultPanel
            result={reclassifyResult}
            onClose={() => setReclassifyResult(null)}
          />
        )}

        {/* Section 3: Email table */}
          <EmailTable emails={sortedEmails} loading={emailsLoading} fetchStarted={fetchLoading || !!fetchJobId} filterClass={filterClass} onRowClick={openEmail} />

        {/* Section 4: Collapsible rules panel */}
        <RulesPanel />
      </main>

      {/* Auto-refresh notification toast */}
      {refreshNotif && (
        <AutoRefreshNotif
          message={refreshNotif.message}
          startedAt={refreshNotif.startedAt}
          durationMs={AUTO_CLOSE_MS}
          onClose={closeRefreshNotif}
        />
      )}
    </div>
  );
}
