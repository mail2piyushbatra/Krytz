import { NavLink } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import NotificationPanel from './NotificationPanel';
import './Sidebar.css';

const navItems = [
  { path: '/', icon: 'C', label: 'Command' },
  { path: '/strategy', icon: 'S', label: 'Strategy' },
  { path: '/timeline', icon: 'T', label: 'Timeline' },
  { path: '/search', icon: 'Q', label: 'Search' },
  { path: '/platform', icon: 'P', label: 'Platform' },
];

export default function Sidebar() {
  const { user } = useAuthStore();

  return (
    <>
      <aside className="sidebar" id="sidebar-nav">
        <div className="sidebar-logo">
          <span className="logo-mark">F</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NotificationPanel />
          <NavLink to="/settings" className="user-avatar" title={user?.name || user?.email}>
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </NavLink>
        </div>
      </aside>

      <nav className="mobile-tabs" id="mobile-tabs">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}
          >
            <span className="tab-icon">{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
