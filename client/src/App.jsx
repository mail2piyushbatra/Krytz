/** ✦ FLOWRA — App Shell + Router */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from './stores/authStore';
import Sidebar from './components/Sidebar';
import AuthScreen from './screens/AuthScreen';
import CommandCenterScreen from './screens/CommandCenterScreen';
import StrategyScreen from './screens/StrategyScreen';
import TimelineScreen from './screens/TimelineScreen';
import RecallScreen from './screens/RecallScreen';
import PlatformScreen from './screens/PlatformScreen';
import SettingsScreen from './screens/SettingsScreen';

export default function App() {
  const { user, loading, init } = useAuthStore();

  useEffect(() => { init(); }, []);

  if (loading) return <SplashScreen />;
  if (!user) return <AuthScreen />;

  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <MainContent />
      </div>
    </BrowserRouter>
  );
}

function MainContent() {
  const location = useLocation();
  return (
    <main className="main-content">
      <div key={location.pathname} className="page-transition">
        <Routes location={location}>
          <Route path="/" element={<CommandCenterScreen />} />
          <Route path="/strategy" element={<StrategyScreen />} />
          <Route path="/timeline" element={<TimelineScreen />} />
          <Route path="/search" element={<RecallScreen />} />
          <Route path="/platform" element={<PlatformScreen />} />
          <Route path="/platform/:role" element={<PlatformScreen />} />
          <Route path="/recall" element={<Navigate to="/search" replace />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </main>
  );
}

function SplashScreen() {
  return (
    <div className="splash" style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <span style={{
        fontSize: '3rem',
        background: 'linear-gradient(135deg, #6c5ce7, #a855f7)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 0 20px rgba(108, 92, 231, 0.4))',
        animation: 'pulse 2s ease-in-out infinite',
      }}>✦</span>
      <span style={{
        color: 'var(--text-tertiary)',
        fontSize: '0.875rem',
        letterSpacing: '3px',
        textTransform: 'uppercase',
      }}>flowra</span>
    </div>
  );
}
