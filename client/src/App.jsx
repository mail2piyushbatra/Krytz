/** ✦ FLOWRA — App Shell + Router (v2)
 *
 * Closes architecture gaps:
 * - #3  Error boundaries (wraps all routes)
 * - #9  Page transitions (CSS animation on route change)
 * - #10 Code splitting (React.lazy for all screens)
 */
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from './stores/authStore';
import { useTheme } from './hooks/useTheme';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { PageLoader as UiPageLoader } from './components/ui/UiKit';

// ── Lazy-loaded screens (code splitting) ──────────────────────
const AuthScreen = lazy(() => import('./screens/AuthScreen'));
const CommandCenterScreen = lazy(() => import('./screens/CommandCenterScreen'));
const StrategyScreen = lazy(() => import('./screens/StrategyScreen'));
const TimelineScreen = lazy(() => import('./screens/TimelineScreen'));
const TasksScreen = lazy(() => import('./screens/TasksScreen'));
const RecallScreen = lazy(() => import('./screens/RecallScreen'));
const PlatformScreen = lazy(() => import('./screens/PlatformScreen'));
const InspectorScreen = lazy(() => import('./screens/InspectorScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const OnboardingScreen = lazy(() => import('./screens/OnboardingScreen'));

function PageLoader() {
  return <UiPageLoader text="Loading..." />;
}

export default function App() {
  const { user, loading, init } = useAuthStore();
  useTheme();

  useEffect(() => { init(); }, []);

  // ── Global Cmd+K / Ctrl+K shortcut ──────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('flowra:open-capture'));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) return <SplashScreen />;

  if (!user) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SplashScreen />}>
          <AuthScreen />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="layout" role="application" aria-label="Flowra application">
          <Sidebar />
          <ErrorBoundary>
            <MainContent />
          </ErrorBoundary>
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}

function MainContent() {
  const location = useLocation();
  const { user } = useAuthStore();
  const isPlatformRoute = location.pathname === '/platform' || location.pathname.startsWith('/platform/');
  const isPlatformUtilityRoute = location.pathname === '/settings';
  const hasPlatformRole = Boolean(user?.platformRole);

  if (user && !user.onboarded && !hasPlatformRole && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  if (user && !user.onboarded && hasPlatformRole && !isPlatformRoute && !isPlatformUtilityRoute && location.pathname !== '/onboarding') {
    return <Navigate to="/platform" replace />;
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
    <div className="splash" role="status" aria-label="Loading Flowra" style={{
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
      }}>✦</span>
      <span style={{
        color: 'var(--text-secondary)',
        fontSize: '0.875rem',
        letterSpacing: '3px',
        textTransform: 'uppercase',
      }}>flowra</span>
    </div>
  );
}
