import { useState } from 'react';
import { connectToServer } from '../services/api';

export default function ConnectionPage({ onConnect }) {
  const [form, setForm] = useState({
    host: '',
    port: '993',
    user: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
              placeholder="imap.gmail.com"
              autoComplete="off"
            />
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
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
