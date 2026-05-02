/** ✦ Krytz — Notification Panel */
import { useState, useEffect, useRef } from 'react';
import { notifications } from '../services/api';
import './NotificationPanel.css';

export default function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef(null);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // poll every 60s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function loadNotifications() {
    try {
      const data = await notifications.list({ limit: 20 });
      const list = data?.notifications || data || [];
      setItems(Array.isArray(list) ? list : []);
      setUnread(Array.isArray(list) ? list.filter(n => !n.read && !n.read_at).length : 0);
    } catch {
      setItems([]);
    }
  }

  async function markAllRead() {
    try {
      await notifications.markAllRead();
      setItems(prev => prev.map(n => ({ ...n, read: true, read_at: new Date().toISOString() })));
      setUnread(0);
    } catch {}
  }

  async function markRead(id) {
    try {
      await notifications.markRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch {}
  }

  function toggle() {
    setOpen(prev => !prev);
  }

  const typeIcons = {
    reminder: '⏰',
    insight: '💡',
    alert: '⚠ï¸',
    achievement: '🏆',
    system: '🔔',
  };

  return (
    <div className="notif-wrapper" ref={panelRef}>
      <button className="notif-bell" onClick={toggle} title="Notifications" id="notif-bell">
        🔔
        {unread > 0 && <span className="notif-badge-count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel glass animate-scaleIn" id="notif-panel">
          <div className="notif-header">
            <h3 className="notif-title">Notifications</h3>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-list">
            {items.length > 0 ? (
              items.map(notif => (
                <div
                  key={notif.id}
                  className={`notif-item ${!notif.read && !notif.read_at ? 'notif-unread' : ''}`}
                  onClick={() => !notif.read && !notif.read_at && markRead(notif.id)}
                >
                  <span className="notif-icon">
                    {typeIcons[notif.type] || typeIcons[notif.notification_type] || '🔔'}
                  </span>
                  <div className="notif-content">
                    <p className="notif-message">{notif.message || notif.title}</p>
                    <span className="notif-time">
                      {formatRelative(notif.created_at || notif.createdAt)}
                    </span>
                  </div>
                  {!notif.read && !notif.read_at && <span className="notif-dot" />}
                </div>
              ))
            ) : (
              <div className="notif-empty">
                <span>🔕</span>
                <p>No notifications yet</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
