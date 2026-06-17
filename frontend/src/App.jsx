import React, { useState, useEffect, useRef } from 'react';
import { getAccounts, resetAccounts, deleteAccount } from './services/api';
import AccountSwitcher from './components/AccountSwitcher';
import ConnectionPage from './pages/ConnectionPage';
import DashboardPage from './pages/DashboardPage';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'var(--error, #ff6b6b)' }}>
          <p>Something went wrong: {this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [credentialsByAccount, setCredentialsByAccount] = useState({});
  const [view, setView] = useState('connection'); // 'connection' | 'dashboard'
  const [switcherCollapsed, setSwitcherCollapsed] = useState(true);
  const userToggledRef = useRef(false);

  // Auto-expand switcher when entering dashboard for the first time in a session,
  // so the user can see "+ Agregar cuenta" without hunting for ☰
  useEffect(() => {
    if (view === 'dashboard' && !userToggledRef.current) {
      setSwitcherCollapsed(false);
    }
  }, [view]);

  // --- Inactivity session expiry (20 minutes) ---
  const SESSION_TIMEOUT_MS = 20 * 60 * 1000
  const inactivityTimer = useRef(null)

  function resetInactivityTimer() {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => {
      setCredentialsByAccount({})
      setView('connection')
      console.log('[session] cleared due to inactivity')
    }, SESSION_TIMEOUT_MS)
  }

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetInactivityTimer))
    resetInactivityTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [])
  // --- End inactivity timer ---

  function refreshAccounts() {
    return getAccounts()
      .then(list => {
        setAccounts(list || []);
        return list || [];
      })
      .catch(() => {
        setAccounts([]);
        return [];
      });
  }

  useEffect(() => {
    async function initSession() {
      try {
        await resetAccounts()
      } catch (err) {
        console.error('[session] failed to reset accounts:', err.message)
      }
      const list = await getAccounts().catch(() => [])
      setAccounts(list)
    }
    initSession()
  }, []);

  function handleSelectAccount(account) {
    setActiveAccountId(account.id);
    if (credentialsByAccount[account.id]) {
      // Already have credentials cached for this session, go straight to dashboard
      setView('dashboard');
    } else {
      // Need to (re)enter credentials for this account
      setView('connection');
    }
  }

  function handleAddAccount() {
    setActiveAccountId(null);
    setView('connection');
    setSwitcherCollapsed(false);
  }

  async function handleConnect(creds) {
    let accountId = activeAccountId || creds.account_id;
    
    // If accountId is missing (e.g. brand new account added), refresh list and find it
    if (!accountId) {
      const list = await refreshAccounts();
      const matched = list.find(a => a.email === creds.user && a.host === creds.host);
      if (matched) {
        accountId = matched.id;
      }
    }

    if (accountId) {
      setCredentialsByAccount(prev => ({
        ...prev,
        [accountId]: { ...creds, account_id: accountId }
      }));
      setActiveAccountId(accountId);
      setView('dashboard');
      refreshAccounts(); // Refresh again to ensure list is updated
    }
  }

  function handleDeleteAccount(account) {
    const confirmed = window.confirm(
      `¿Eliminar la cuenta ${account.label || account.email}? Se borrarán todos sus correos y departamentos.`
    )
    if (!confirmed) return

    deleteAccount(account.id)
      .then(() => {
        setAccounts(prev => prev.filter(a => a.id !== account.id))
        setCredentialsByAccount(prev => {
          const next = { ...prev }
          delete next[account.id]
          return next
        })
        if (activeAccountId === account.id) {
          setActiveAccountId(null)
          setView('connection')
        }
      })
      .catch(err => {
        alert(err.message || 'No se pudo eliminar la cuenta')
      })
  }

  function handleDisconnect() {
    // Keep credentials cached, just go back to connection view
    // so the account list and + Agregar cuenta remain visible
    setView('connection');
  }

  const activeAccount = accounts.find(a => a.id === activeAccountId) || null;
  const activeCredentials = activeAccountId 
    ? credentialsByAccount[activeAccountId] 
    : null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <div className="sidebar-root">
        <AccountSwitcher
          accounts={accounts}
          activeId={activeAccountId}
          onSelect={handleSelectAccount}
          onAdd={handleAddAccount}
          onDelete={handleDeleteAccount}
          collapsed={switcherCollapsed}
          onToggleCollapse={() => {
            userToggledRef.current = true;
            setSwitcherCollapsed(v => !v);
          }}
        />
      </div>
      <div style={{ flex: 1 }}>
        {view === 'dashboard' && activeCredentials ? (
          <ErrorBoundary>
            <DashboardPage
              key={activeAccountId}
              credentials={activeCredentials}
              account={activeAccount}
              onDisconnect={handleDisconnect}
              showAccountPanel={!switcherCollapsed}
              onToggleAccountPanel={() => setSwitcherCollapsed(v => !v)}
            />
          </ErrorBoundary>
        ) : (
          <ConnectionPage
            account={activeAccount}
            onConnect={handleConnect}
            onAccountCreated={refreshAccounts}
          />
        )}
      </div>
    </div>
  );
}
