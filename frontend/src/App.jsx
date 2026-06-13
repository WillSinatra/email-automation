import React, { useState, useEffect } from 'react';
import { getAccounts } from './services/api';
import AccountSwitcher from './components/AccountSwitcher';
import ConnectionPage from './pages/ConnectionPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);

  useEffect(() => {
    getAccounts()
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const handleConnect = (creds) => {
    setCredentials(creds);
    setAddingAccount(false);
    getAccounts().then(setAccounts).catch(() => {});
  };

  const handleSelectAccount = (account) => {
    setActiveAccount(account);
    setCredentials(null);
    setShowAccountPanel(true);
  };

  const handleDisconnect = () => {
    setCredentials(null);
    setActiveAccount(null);
  };

  const handleAddAccount = () => {
    setActiveAccount(null);
    setCredentials(null);
    setAddingAccount(true);
    setShowAccountPanel(true);
  };

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

  if (addingAccount || (!credentials && !activeAccount)) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {showAccountPanel && (
          <AccountSwitcher
            accounts={accounts}
            activeId={activeAccount?.id}
            onSelect={handleSelectAccount}
            onAdd={handleAddAccount}
            onToggle={() => setShowAccountPanel(false)}
          />
        )}
        <div style={{ flex: 1 }}>
          <ConnectionPage
            onConnect={handleConnect}
            onAccountCreated={() => getAccounts().then(setAccounts).catch(() => {})}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {showAccountPanel && (
        <AccountSwitcher
          accounts={accounts}
          activeId={activeAccount?.id || null}
          onSelect={handleSelectAccount}
          onAdd={handleAddAccount}
          onToggle={() => setShowAccountPanel(false)}
        />
      )}
      <div style={{ flex: 1 }}>
        <ErrorBoundary>
          <DashboardPage
            credentials={{ ...credentials, account_id: activeAccount?.id }}
            account={activeAccount}
            onDisconnect={handleDisconnect}
            showAccountPanel={showAccountPanel}
            onToggleAccountPanel={() => setShowAccountPanel(prev => !prev)}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}