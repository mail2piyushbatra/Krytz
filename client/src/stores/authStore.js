/** ✦ FLOWRA — Auth Store (Zustand) */
import { create } from 'zustand';
import { auth as authApi, setAuthCallback, getToken, clearTokens } from '../services/api';

const useAuthStore = create((set, get) => ({
  user: null,
  loading: true,
  error: null,

  init: async () => {
    const token = getToken();
    if (!token) { set({ loading: false }); return; }
    try {
      const user = await authApi.me();
      set({ user, loading: false });
    } catch {
      clearTokens();
      set({ user: null, loading: false });
    }
    setAuthCallback(() => {
      clearTokens();
      set({ user: null });
    });
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const user = await authApi.login(email, password);
      set({ user, error: null });
      return user;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  register: async (email, password, name) => {
    set({ error: null });
    try {
      const user = await authApi.register(email, password, name);
      set({ user, error: null });
      return user;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  logout: () => {
    authApi.logout();
    set({ user: null });
  },

  /** Merge updated fields into the in-memory user object after a profile PATCH */
  updateUser: (fields) => set((state) => ({
    user: state.user ? { ...state.user, ...fields } : state.user,
  })),

  clearError: () => set({ error: null }),
}));

export default useAuthStore;
