import { create } from 'zustand';
import { api } from '../services/api';

export const useEntryStore = create((set) => ({
  entries: [],
  isLoading: false,
  error: null,

  loadEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.entries.list();
      set({ entries: res.data?.entries || [], isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  }
}));
