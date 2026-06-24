// Empty string = relative URLs so requests go through Vite's dev proxy (port 5173),
// which forwards /api/* to the backend. This avoids CORS issues entirely in dev.
// In production, set this to your production API URL via an env var if needed.
const BASE = '';
const REQUEST_TIMEOUT_MS = 300000;

function countEncodingArtifacts(value) {
  const text = String(value || '');
  const matches = text.match(/\uFFFD|\u00c3.|\u00c2.|\u00e2\u20ac|\u00e2\u0080/g);
  return matches ? matches.length : 0;
}

function repairUtf8Mojibake(value) {
  let text = String(value || '');
  if (!/[\u00c3\u00c2\u00e2]/.test(text)) return text;

  for (let i = 0; i < 3; i += 1) {
    try {
      const bytes = Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0) & 0xFF));
      const repaired = new TextDecoder('utf-8').decode(bytes);
      if (countEncodingArtifacts(repaired) >= countEncodingArtifacts(text)) break;
      text = repaired;
    } catch (_) {
      break;
    }
  }

  return text;
}

function decodeEmailEntities(value) {
  if (!value) return '';
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aacute: '\u00e1',
    eacute: '\u00e9',
    iacute: '\u00ed',
    oacute: '\u00f3',
    uacute: '\u00fa',
    Aacute: '\u00c1',
    Eacute: '\u00c9',
    Iacute: '\u00cd',
    Oacute: '\u00d3',
    Uacute: '\u00da',
    ntilde: '\u00f1',
    Ntilde: '\u00d1',
    uuml: '\u00fc',
    Uuml: '\u00dc',
    deg: '\u00b0',
    ordm: '\u00ba',
  };

  return String(value)
    .replace(/&=\r?\n\s*([a-zA-Z][a-zA-Z0-9]+);/g, '&$1;')
    .replace(/&=,?\s*([a-zA-Z][a-zA-Z0-9]+);?/g, '&$1;')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(named, name) ? named[name] : match
    ));
}

function normalizeEmailText(value) {
  return decodeEmailEntities(repairUtf8Mojibake(value))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeEmailResponse(data) {
  if (Array.isArray(data)) return data.map(normalizeEmailResponse);
  if (!data || typeof data !== 'object') return data;

  const normalized = { ...data };
  ['subject', 'raw_sender', 'sender', 'text', 'html', 'filename'].forEach((key) => {
    if (typeof normalized[key] === 'string') {
      normalized[key] = normalizeEmailText(normalized[key]);
    }
  });
  return normalized;
}

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  opts.signal = controller.signal;

  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    if (path.startsWith('/api/emails') || path.startsWith('/api/attachments')) {
      return normalizeEmailResponse(data);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Account API =====
export const getAccounts = () =>
  request('GET', '/api/accounts');

export const createAccount = (email, host, port, label) =>
  request('POST', '/api/accounts', { email, host, port, label });

export const deleteAccount = (id) =>
  request('DELETE', `/api/accounts/${id}`);

export const resetAccounts = () =>
  request('DELETE', '/api/accounts/reset');

export const updateAccount = (id, data) =>
  request('PATCH', `/api/accounts/${id}`, data);

// ===== Connection =====
export const connectToServer = (credentials) =>
  request('POST', '/api/connect', credentials);

// ===== Emails =====
export const fetchEmails = (credentials, limit = 50) =>
  request('POST', '/api/fetch-emails', { ...credentials, limit,
    account_id: credentials.account_id });

export const getFetchStatus = (jobId) =>
  request('GET', `/api/fetch-status/${encodeURIComponent(jobId)}`);

export const getEmails = (classification, accountId) => {
  const params = new URLSearchParams();
  if (classification && classification !== 'all') {
    params.set('classification', classification);
  }
  if (accountId) params.set('account_id', accountId);
  const q = params.toString() ? `?${params.toString()}` : '';
  return request('GET', `/api/emails${q}`);
};

export const clearEmails = (accountId) =>
  request('DELETE', `/api/emails${accountId ? `?account_id=${accountId}` : ''}`);

export const getEmailById = (id, accountId) => {
  const q = accountId ? `?account_id=${accountId}` : '';
  return request('GET', `/api/emails/${id}${q}`);
};

export const getEmailAttachments = (emailId) => request('GET', `/api/emails/${emailId}/attachments`);

export const getAttachmentUrl = (id) => `${BASE}/api/attachments/${encodeURIComponent(id)}`;

export async function downloadAttachment(id) {
  const url = getAttachmentUrl(id);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return blob;
}

// ===== Rules =====
export const getRules = () => request('GET', '/api/rules');

export const addRule = (domain, category) =>
  request('POST', '/api/rules', { domain, category });

export const deleteRule = (domain) =>
  request('DELETE', `/api/rules/${encodeURIComponent(domain)}`);

// ===== Misc =====
export const markAsRead = (id) =>
  request('PATCH', `/api/emails/${id}/read`);

export const reclassifySpam = (accountId) =>
  request('POST', `/api/reclassify-spam?account_id=${accountId || 'default'}`);

export const getDateRange = () =>
  request('GET', '/api/date-range');

// Email counts
export const getEmailCounts = (accountId) => {
  const q = accountId ? `?account_id=${accountId}` : '';
  return request('GET', `/api/emails/counts${q}`);
};

// Departments API
export const getDepartments = (accountId) => {
  const q = accountId ? `?account_id=${accountId}` : '';
  return request('GET', `/api/departments${q}`);
};

export const createDepartment = (name, label, description, keywords, accountId) =>
  request('POST', '/api/departments', { name, label, description, keywords, account_id: accountId });

export const updateDepartment = (id, name, label, keywords, description) =>
  request('PUT', `/api/departments/${id}`, { name, label, keywords, description });

export const deleteDepartment = (id) =>
  request('DELETE', `/api/departments/${id}`);

export const sendEmail = (credentials, emailData) =>
  request('POST', '/api/send-email', {
    user: credentials.user,
    password: credentials.password,
    account_id: credentials.account_id,
    ...emailData
  })
