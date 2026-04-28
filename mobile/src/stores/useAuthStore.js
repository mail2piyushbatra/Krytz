import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const setToken = async (token, refreshToken) => {
  if (Platform.OS === 'web') {
    localStorage.setItem('flowra_token', token);
    if (refreshToken) localStorage.setItem('flowra_refresh_token', refreshToken);
  } else {
    await SecureStore.setItemAsync('flowra_token', token);
    if (refreshToken) await SecureStore.setItemAsync('flowra_refresh_token', refreshToken);
  }
};

const getToken = async () => {
  if (Platform.OS === 'web') {
    return localStorage.getItem('flowra_token');
  } else {
    return await SecureStore.getItemAsync('flowra_token');
  }
};

export const getRefreshToken = async () => {
  if (Platform.OS === 'web') {
    return localStorage.getItem('flowra_refresh_token');
  } else {
    return await SecureStore.getItemAsync('flowra_refresh_token');
  }
};

export const removeToken = async () => {
  if (Platform.OS === 'web') {
    localStorage.removeItem('flowra_token');
    localStorage.removeItem('flowra_refresh_token');
  } else {
    await SecureStore.deleteItemAsync('flowra_token');
    await SecureStore.deleteItemAsync('flowra_refresh_token');
  }
};
import { api } from '../services/api';

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isLoading: true,
  error: null,

  init: async () => {
    try {
      const token = await getToken();
      if (token) {
        const res = await api.auth.me();
        set({ user: res.data.user, token, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      try { await removeToken(); } catch(e) {}
      set({ user: null, token: null, isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.auth.login(email, password);
      await setToken(res.data.accessToken, res.data.refreshToken);
      set({ user: res.data.user, token: res.data.accessToken, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  register: async (name, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.auth.register(name, email, password);
      await setToken(res.data.accessToken, res.data.refreshToken);
      set({ user: res.data.user, token: res.data.accessToken, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  updateProfile: async (updates) => {
    try {
      const res = await api.auth.updateProfile(updates);
      set({ user: res.data.user });
    } catch (error) {
      throw error;
    }
  },

  logout: async () => {
    await removeToken();
    set({ user: null, token: null });
  },
}));
