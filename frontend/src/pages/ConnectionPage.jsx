import { useState, useEffect } from 'react';
import { connectToServer, createAccount } from '../services/api';

export default function ConnectionPage({ onConnect, onAccountCreated, account }) {
  const [form, setForm] = useState({
    host: account?.host || 'imap.netlatin.com.ar',
    port: account?.port || '993',
    user: account?.email || '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (account) {
      setForm(prev => ({
        ...prev,
        host: account.host || 'imap.netlatin.com.ar',
        port: account.port || '993',
        user: account.email || '',
        // keep the typed password if the user is the same, otherwise clear it
        password: prev.user === account.email ? prev.password : '',
      }));
    } else {
      setForm({
        host: 'imap.netlatin.com.ar',
        port: '993',
        user: '',
        password: '',
      });
    }
  }, [account]);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const { host, port, user, password } = form;

    if (!host || !port || !user || !password) {
      setError('Please complete all fields.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const creds = { host, port: Number(port), user, password };
      await connectToServer(creds);

      // Register the account in the accounts table
      try {
        await createAccount(user, host, Number(port), user);
        if (onAccountCreated) onAccountCreated();
      } catch (accErr) {
        // Account may already exist — that's fine
        console.warn('Account registration:', accErr.message);
      }

      onConnect(creds);
    } catch (err) {
      setError(err.message || 'Connection failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="connection-page">
      <div className="connection-card">
        <h1 className="connection-title">Email Automation</h1>
        <p className="connection-subtitle">
          Connect to your IMAP mail server
        </p>

        <form onSubmit={handleSubmit} className="connection-form" noValidate>
          <div className="field">
            <label className="label">Host / server address</label>
            <input
              className="input"
              type="text"
              value={form.host}
              onChange={set('host')}
              placeholder="imap.netlatin.com.ar"
              autoComplete="off"
            />
            <span className="add-dept-hint">
              Servidor por defecto: <strong>imap.netlatin.com.ar</strong>
            </span>
          </div>

          <div className="field">
            <label className="label">Port</label>
            <input
              className="input"
              type="number"
              value={form.port}
              onChange={set('port')}
              min="1"
              max="65535"
            />
          </div>

          <div className="field">
            <label className="label">Username / email</label>
            <input
              className="input"
              type="text"
              value={form.user}
              onChange={set('user')}
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}