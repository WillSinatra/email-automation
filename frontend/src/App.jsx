import { useState } from 'react';
import ConnectionPage from './pages/ConnectionPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const [credentials, setCredentials] = useState(null);

  return credentials
    ? <DashboardPage credentials={credentials} onDisconnect={() => setCredentials(null)} />
    : <ConnectionPage onConnect={setCredentials} />;
}
