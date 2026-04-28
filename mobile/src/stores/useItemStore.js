import { create } from 'zustand';
import { api } from '../services/api';

export const useItemStore = create((set, get) => ({
  items: [],
  overview: null,
  focus: null,
  isLoading: false,
  error: null,

  loadData: async () => {
    set({ isLoading: true, error: null });
    try {
      const [itemsRes, overviewRes, planRes] = await Promise.all([
        api.items.list({ sort: 'priority' }),
        api.analytics.overview(),
        api.plan.today().catch(() => null)
      ]);
      
      set({
        items: itemsRes.data?.items || [],
        overview: overviewRes.data || null,
        focus: planRes?.data?.focus || null,
        isLoading: false
      });
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  },

  markDone: async (item) => {
    // Optimistic update
    set(state => ({
      items: state.items.filter(i => i.id !== item.id),
      overview: state.overview ? {
        ...state.overview,
        summary: {
          ...state.overview.summary,
          totalDone: (state.overview.summary.totalDone || 0) + 1,
          totalOpen: Math.max(0, (state.overview.summary.totalOpen || 0) - 1)
        }
      } : null
    }));

    try {
      await api.items.update(item.id, { state: 'DONE' });
      // Background reload to sync
      get().loadData();
    } catch (error) {
      // Revert optimism on error
      get().loadData();
    }
  },

  toggleBlocker: async (item) => {
    set(state => ({
      items: state.items.map(i => i.id === item.id ? { ...i, blocker: !i.blocker } : i)
    }));

    try {
      await api.items.update(item.id, { blocker: !item.blocker });
      get().loadData();
    } catch (error) {
      get().loadData();
    }
  }
}));
