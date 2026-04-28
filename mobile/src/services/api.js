import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8301/api/v1' : 'http://localhost:8301/api/v1';

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

async function fetchWithAuth(endpoint, options = {}, isRetry = false) {
  let token = null;
  if (Platform.OS === 'web') {
    token = localStorage.getItem('flowra_token');
  } else {
    token = await SecureStore.getItemAsync('flowra_token');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !isRetry && endpoint !== '/auth/login' && endpoint !== '/auth/refresh') {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(newToken => {
          options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
          return fetchWithAuth(endpoint, options, true);
        }).catch(err => {
          throw err;
        });
      }

      isRefreshing = true;

      try {
        let refreshToken = null;
        if (Platform.OS === 'web') {
          refreshToken = localStorage.getItem('flowra_refresh_token');
        } else {
          refreshToken = await SecureStore.getItemAsync('flowra_refresh_token');
        }

        if (!refreshToken) throw new Error('No refresh token');

        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        
        const refreshData = await refreshRes.json();
        
        if (!refreshRes.ok) throw new Error('Refresh failed');
        
        const newToken = refreshData.data.accessToken;
        const newRefresh = refreshData.data.refreshToken;

        if (Platform.OS === 'web') {
          localStorage.setItem('flowra_token', newToken);
          localStorage.setItem('flowra_refresh_token', newRefresh);
        } else {
          await SecureStore.setItemAsync('flowra_token', newToken);
          await SecureStore.setItemAsync('flowra_refresh_token', newRefresh);
        }

        isRefreshing = false;
        processQueue(null, newToken);

        options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
        return fetchWithAuth(endpoint, options, true);
      } catch (err) {
        isRefreshing = false;
        processQueue(err, null);
        
        if (Platform.OS === 'web') {
          localStorage.removeItem('flowra_token');
          localStorage.removeItem('flowra_refresh_token');
        } else {
          await SecureStore.deleteItemAsync('flowra_token');
          await SecureStore.deleteItemAsync('flowra_refresh_token');
        }
        throw new Error('Session expired');
      }
    }
    throw new Error(data.error?.message || data.message || 'API Request failed');
  }

  return data;
}

export const api = {
  auth: {
    login: (email, password) => fetchWithAuth('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (name, email, password) => fetchWithAuth('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
    me: () => fetchWithAuth('/auth/me'),
    updateProfile: (updates) => fetchWithAuth('/auth/me', { method: 'PATCH', body: JSON.stringify(updates) }),
  },
  items: {
    list: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return fetchWithAuth(`/items${qs ? '?' + qs : ''}`);
    },
    update: (id, updates) => fetchWithAuth(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
    completions: (days = 7) => fetchWithAuth(`/items/completions?days=${days}`),
  },
  entries: {
    capture: (rawText, options = {}) => fetchWithAuth('/entries', { method: 'POST', body: JSON.stringify({ rawText, ...options }) }),
    list: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return fetchWithAuth(`/entries${qs ? '?' + qs : ''}`);
    },
  },
  analytics: {
    overview: () => fetchWithAuth('/analytics/overview'),
  },
  plan: {
    today: () => fetchWithAuth('/plan/today'),
  },
  recall: {
    query: (query) => fetchWithAuth('/recall', { method: 'POST', body: JSON.stringify({ query }) }),
  },
  files: {
    getUploadUrl: (fileName, fileType, fileSize) => fetchWithAuth('/files/upload-url', { method: 'POST', body: JSON.stringify({ fileName, fileType, fileSize }) }),
    confirm: (fileKey, entryId) => fetchWithAuth('/files/confirm', { method: 'POST', body: JSON.stringify({ fileKey, entryId }) })
  }
};
