import React, { useState } from 'react';
import ConnectionPage from './pages/ConnectionPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const [credentials, setCredentials] = useState(() => {
    try {
      const saved = sessionStorage.getItem('credentials');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleConnect = (creds) => {
    try { sessionStorage.setItem('credentials', JSON.stringify(creds)); } catch {};
    setCredentials(creds);
  };

  const handleDisconnect = () => {
    try { sessionStorage.removeItem('credentials'); } catch {};
    setCredentials(null);
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

  return credentials
    ? (
      <ErrorBoundary>
        <DashboardPage credentials={credentials} onDisconnect={handleDisconnect} />
      </ErrorBoundary>
    )
    : <ConnectionPage onConnect={handleConnect} />;
}
