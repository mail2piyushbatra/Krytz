/** âœ¦ Krytz â€” App Shell + Router (v2)
 *
 * Closes architecture gaps:
 * - #3  Error boundaries (wraps all routes)
 * - #9  Page transitions (CSS animation on route change)
 * - #10 Stable route rendering (screens imported eagerly)
 */
import { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from './stores/authStore';
import { useTheme } from './hooks/useTheme';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { OfflineBanner } from './components/OfflineBanner';
import { PageLoader as UiPageLoader } from './components/ui/UiKit';
import AuthScreen from './screens/AuthScreen';
import CommandCenterScreen from './screens/CommandCenterScreen';
import StrategyScreen from './screens/StrategyScreen';
import TimelineScreen from './screens/TimelineScreen';
import TasksScreen from './screens/TasksScreen';
import RecallScreen from './screens/RecallScreen';
import PlatformScreen from './screens/PlatformScreen';
import InspectorScreen from './screens/InspectorScreen';
import SettingsScreen from './screens/SettingsScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { PrivacyScreen, TermsScreen } from './screens/LegalScreen';

// â”€â”€ Lazy-loaded screens (code splitting) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PLATFORM_LANDING_BY_ROLE = {
  founder: '/platform/founder',
  operator: '/platform/operator',
  devops: '/platform/devops',
  coder: '/platform/coder',
  support: '/platform/support',
};

function getPlatformLanding(user) {
  return PLATFORM_LANDING_BY_ROLE[user?.platformRole || user?.role] || '/platform/hub';
}

function PageLoader() {
  return <UiPageLoader text="Loading..." />;
}

export default function App() {
  const { user, loading, init } = useAuthStore();
  useTheme();

  useEffect(() => { init(); }, []);

  // â”€â”€ Global Cmd+K / Ctrl+K shortcut â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('Krytz:open-capture'));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          <OfflineBanner />
          <Suspense fallback={<SplashScreen />}>
            <Routes>
              {/* Public legal pages — accessible without login */}
              <Route path="/privacy" element={<PrivacyScreen />} />
              <Route path="/terms" element={<TermsScreen />} />
              {/* Everything else: gated on auth */}
              <Route path="*" element={<AuthGate loading={loading} user={user} />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

function AuthGate({ loading, user }) {
  if (loading) return <SplashScreen />;
  if (!user) return <AuthScreen />;
  return (
    <div className="layout" role="application" aria-label="Krytz application">
      <Sidebar />
      <ErrorBoundary>
        <MainContent />
      </ErrorBoundary>
    </div>
  );
}

function MainContent() {
  const location = useLocation();
  const { user } = useAuthStore();
  const isPlatformRoute = location.pathname === '/platform' || location.pathname.startsWith('/platform/');
  const isPlatformUtilityRoute = location.pathname === '/settings';
  const hasPlatformRole = Boolean(PLATFORM_LANDING_BY_ROLE[user?.platformRole || user?.role]);
  const isLegacyUserRoute = ['/', '/strategy', '/timeline', '/tasks', '/search', '/recall'].includes(location.pathname);
  const platformLanding = getPlatformLanding(user);

  if (user && !user.onboarded && !hasPlatformRole && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  if (user && !user.onboarded && hasPlatformRole && !isPlatformRoute && !isPlatformUtilityRoute && location.pathname !== '/onboarding') {
    return <Navigate to={platformLanding} replace />;
  }
  if (user && hasPlatformRole && isLegacyUserRoute) {
    return <Navigate to={platformLanding} replace />;
  }
  if (user && hasPlatformRole && location.pathname === '/platform') {
    return <Navigate to={platformLanding} replace />;
  }

  return (
    <main className="main-content" role="main" aria-label="Page content">
      <Suspense fallback={<PageLoader />}>
        <div key={location.pathname} className="page-transition">
          <Routes location={location}>
            <Route path="/onboarding" element={<OnboardingScreen />} />
            <Route path="/" element={<CommandCenterScreen />} />
            <Route path="/strategy" element={<StrategyScreen />} />
            <Route path="/timeline" element={<TimelineScreen />} />
            <Route path="/tasks" element={<TasksScreen />} />
            <Route path="/search" element={<RecallScreen />} />
            <Route path="/platform" element={<PlatformScreen />} />
            <Route path="/platform/:role" element={<PlatformScreen />} />
            <Route path="/inspector" element={<InspectorScreen />} />
            <Route path="/recall" element={<Navigate to="/search" replace />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Suspense>
    </main>
  );
}

function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="Loading Krytz" style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '16px',
      background: 'var(--bg-primary)',
    }}>
      <span style={{
        fontSize: '3rem',
        background: 'var(--accent-gradient)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 0 20px rgba(200, 164, 90, 0.2))',
        animation: 'pulse 2s ease-in-out infinite',
      }}>âœ¦</span>
      <span style={{
        color: 'var(--text-secondary)',
        fontSize: '0.875rem',
        letterSpacing: '3px',
        textTransform: 'uppercase',
      }}>Krytz</span>
    </div>
  );
}
