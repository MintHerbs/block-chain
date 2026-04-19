import { Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/Sidebar.jsx';
import BlockchainCard from './components/BlockchainCard.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import TemporalPage from './pages/TemporalPage.jsx';
import Loader from './components/ui/Loader.jsx';
import './App.css';

// Layout wrapping authenticated pages: sidebar + content + right sidebar
function AuthLayout() {
  const [blockchainRecords, setBlockchainRecords] = useState([]);

  return (
    <div className="layout" style={{ display: 'flex', minHeight: '100vh', maxWidth: '1480px', margin: '0 auto' }}>
      <div style={{ width: '260px', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
        <Sidebar />
      </div>
      <main style={{ flex: 1, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', maxWidth: '600px', minHeight: '100vh' }}>
        <Outlet context={{ blockchainRecords }} />
      </main>
      <aside style={{ width: '280px', flexShrink: 0, padding: '20px 16px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <BlockchainCard onRecordsFetched={setBlockchainRecords} />
      </aside>
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Loader size="md" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AuthLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/profile/:username" element={<ProfilePage />} />
          <Route path="/temporal" element={<TemporalPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
