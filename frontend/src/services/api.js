const BASE = 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 15000;

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

export const connectToServer = (credentials) =>
  request('POST', '/api/connect', credentials);

export const fetchEmails = (credentials, limit = 50) =>
  request('POST', '/api/fetch-emails', { ...credentials, limit });

export const getEmails = (classification) => {
  const q =
    classification && classification !== 'all'
      ? `?classification=${classification}`
      : '';
  return request('GET', `/api/emails${q}`);
};

export const clearEmails = () => request('DELETE', '/api/emails');

export const getEmailById = (id) => request('GET', `/api/emails/${id}`);

export const getRules = () => request('GET', '/api/rules');

export const addRule = (domain, category) =>
  request('POST', '/api/rules', { domain, category });

export const deleteRule = (domain) =>
  request('DELETE', `/api/rules/${encodeURIComponent(domain)}`);
