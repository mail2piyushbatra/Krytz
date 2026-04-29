/** ✦ FLOWRA — Sidebar (v2)
 * 
 * Closes gaps:
 * 1. Proper SVG icons instead of single letters
 * 2. Unread notification badge count (delegated to NotificationPanel which already has it)
 * 3. Sidebar collapse toggle (icon-only ↔ expanded with labels)
 * 4. Settings added to main nav
 */
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import NotificationPanel from './NotificationPanel';
import './Sidebar.css';

// ── SVG Icon components (inline, zero dependencies) ─────────────
function IconCommand() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconStrategy() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
    </svg>
  );
}

function IconTimeline() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconPlatform() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function IconInspector() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

const navItems = [
  { path: '/', icon: IconCommand, label: 'Command', mobileIcon: '⊞', userOnly: true },
  { path: '/strategy', icon: IconStrategy, label: 'Strategy', mobileIcon: '⊡', userOnly: true },
  { path: '/tasks', icon: IconTasks, label: 'Tasks', mobileIcon: '☑', userOnly: true },
  { path: '/timeline', icon: IconTimeline, label: 'Timeline', mobileIcon: '⊙', userOnly: true },
  { path: '/search', icon: IconSearch, label: 'Search', mobileIcon: '⊘', userOnly: true },
  { path: '/platform', icon: IconPlatform, label: 'Platform', mobileIcon: '⊟', platformOnly: true },
  { path: '/inspector', icon: IconInspector, label: 'Inspector', mobileIcon: '⌕', platformOnly: true },
  { path: '/settings', icon: IconSettings, label: 'Settings', mobileIcon: '⊛' },
];

const PLATFORM_ROLES = ['founder', 'operator', 'devops', 'coder', 'support'];
const PLATFORM_LANDING_BY_ROLE = {
  founder: '/platform/founder',
  operator: '/platform/operator',
  devops: '/platform/devops',
  coder: '/platform/coder',
  support: '/platform/support',
};

export default function Sidebar() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(true); // start collapsed (icon-only)
  const platformRole = user?.platformRole || user?.role;
  const platformLanding = PLATFORM_LANDING_BY_ROLE[platformRole] || '/platform/hub';
  const hasPlatformAccess = PLATFORM_ROLES.includes(platformRole);
  const visibleNavItems = navItems.filter(item => {
    if (item.platformOnly && !hasPlatformAccess) return false;
    if (item.userOnly && hasPlatformAccess) return false;
    return true;
  }).map(item => {
    if (item.platformOnly && item.path === '/platform') {
      return { ...item, path: platformLanding, activeMatch: '/platform' };
    }
    return item;
  });

  return (
    <>
      <aside className={`sidebar ${collapsed ? '' : 'sidebar-expanded'}`} id="sidebar-nav">
        <div className="sidebar-logo">
          <span className="logo-mark">F</span>
          {!collapsed && <span className="logo-text">flowra</span>}
        </div>

        <nav className="sidebar-nav">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => `nav-item ${isActive || (item.activeMatch && location.pathname.startsWith(item.activeMatch)) ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon"><Icon /></span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <NotificationPanel />
          <NavLink to="/settings" className="user-avatar" title={user?.name || user?.email}>
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </NavLink>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconExpand /> : <IconCollapse />}
          </button>
        </div>
      </aside>

      <nav className="mobile-tabs" id="mobile-tabs">
        {visibleNavItems.filter(item => item.path !== '/settings').map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `mobile-tab ${isActive || (item.activeMatch && location.pathname.startsWith(item.activeMatch)) ? 'active' : ''}`}
            >
              <span className="tab-icon"><Icon /></span>
              <span className="tab-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
