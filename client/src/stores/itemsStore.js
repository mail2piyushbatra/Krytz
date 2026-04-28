/** ✦ FLOWRA — Items Store (Zustand)
 *
 * Centralized state for items across screens.
 * Supports optimistic updates, reducing redundant API calls.
 */
import { create } from 'zustand';
import { items as itemsApi } from '../services/api';

const useItemsStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,
  lastFetched: null,
  filters: { sort: 'priority' },

  /** Fetch items with optional filters. Skips if data is fresh (<10s old). */
  fetch: async (filters = {}, force = false) => {
    const merged = { ...get().filters, ...filters };
    const now = Date.now();
    if (!force && get().lastFetched && now - get().lastFetched < 10_000 && get().items.length > 0) {
      return get().items;
    }
    set({ loading: true, error: null, filters: merged });
    try {
      const res = await itemsApi.list(merged);
      const list = res?.items || [];
      set({ items: list, loading: false, lastFetched: Date.now() });
      return list;
    } catch (err) {
      set({ error: err.message, loading: false });
      return [];
    }
  },

  /** Optimistic mark-done: instantly move to DONE, then confirm with API */
  markDone: async (id) => {
    const prev = get().items;
    set({ items: prev.map(i => i.id === id ? { ...i, state: 'DONE' } : i) });
    try {
      await itemsApi.markDone(id);
      // Refresh to get server-side side effects
      get().fetch({}, true);
    } catch {
      set({ items: prev }); // rollback
    }
  },

  /** Optimistic toggle blocker */
  toggleBlocker: async (id, isBlocked) => {
    const prev = get().items;
    set({ items: prev.map(i => i.id === id ? { ...i, blocker: isBlocked } : i) });
    try {
      await itemsApi.toggleBlocker(id, isBlocked);
    } catch {
      set({ items: prev });
    }
  },

  /** Optimistic remove */
  remove: async (id) => {
    const prev = get().items;
    set({ items: prev.filter(i => i.id !== id) });
    try {
      await itemsApi.remove(id);
    } catch {
      set({ items: prev });
    }
  },

  /** Update item fields optimistically */
  update: async (id, fields) => {
    const prev = get().items;
    set({ items: prev.map(i => i.id === id ? { ...i, ...fields } : i) });
    try {
      await itemsApi.update(id, fields);
    } catch {
      set({ items: prev });
    }
  },

  /** Invalidate cache so next fetch is forced */
  invalidate: () => set({ lastFetched: null }),
}));

export default useItemsStore;
