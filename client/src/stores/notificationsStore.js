/** âœ¦ Krytz â€” Notifications Store (Zustand)
 *
 * Centralized notification state. Polled every 60s.
 * Exposes unread count for badge display.
 */
import { create } from 'zustand';
import { notifications as notifApi } from '../services/api';

const useNotificationsStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  pollInterval: null,

  fetch: async () => {
    try {
      const data = await notifApi.list({ limit: 30 });
      const list = Array.isArray(data?.notifications || data) ? (data?.notifications || data) : [];
      const unread = list.filter(n => !n.read && !n.read_at).length;
      set({ notifications: list, unreadCount: unread });
    } catch {
      /* silent */
    }
  },

  markRead: async (id) => {
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
    try { await notifApi.markRead(id); } catch {}
  },

  markAllRead: async () => {
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true, read_at: new Date().toISOString() })),
      unreadCount: 0,
    }));
    try { await notifApi.markAllRead(); } catch {}
  },

  startPolling: () => {
    get().fetch();
    const id = setInterval(() => get().fetch(), 60_000);
    set({ pollInterval: id });
  },

  stopPolling: () => {
    clearInterval(get().pollInterval);
    set({ pollInterval: null });
  },
}));

export default useNotificationsStore;
