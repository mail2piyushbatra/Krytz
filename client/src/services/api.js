/** ✦ FLOWRA — API Client
 *  Connects to the Express backend on localhost:3001.
 *  Handles JWT auth, auto-refresh, and response unwrapping.
 */

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8301/api/v1';

let accessToken = localStorage.getItem('flowra_token');
let refreshToken = localStorage.getItem('flowra_refresh');
let onUnauthorized = null;

export function setAuthCallback(cb) { onUnauthorized = cb; }

function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('flowra_token', access);
  else localStorage.removeItem('flowra_token');
  if (refresh) localStorage.setItem('flowra_refresh', refresh);
  else localStorage.removeItem('flowra_refresh');
}

export function clearTokens() { setTokens(null, null); }
export function getToken() { return accessToken; }

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && refreshToken && !options._retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, { ...options, _retried: true });
    onUnauthorized?.();
    throw new ApiError('Session expired', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error?.message || body.error || body.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }

  if (res.status === 204) return null;
  const body = await res.json();

  // Unwrap { success, data } envelope used by Prisma routes
  if (body && body.success !== undefined && body.data !== undefined) {
    return body.data;
  }
  return body;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const raw = await res.json();
    const data = raw.data || raw;
    setTokens(data.accessToken, data.refreshToken || refreshToken);
    return true;
  } catch { return false; }
}

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ── Auth ──────────────────────────────────────────────────
export const auth = {
  async register(email, password, name) {
    const data = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    setTokens(data.accessToken, data.refreshToken);
    return data.user;
  },
  async login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(data.accessToken, data.refreshToken);
    return data.user;
  },
  async me() {
    const data = await request('/auth/me');
    return data.user || data;
  },
  logout() {
    clearTokens();
  },
};

// ── Capture / Entries ─────────────────────────────────────
export const entries = {
  async capture(rawInput) {
    try {
      return await request('/capture', {
        method: 'POST',
        body: JSON.stringify({ raw_input: rawInput, source: 'manual' }),
      });
    } catch {
      return request('/entries', {
        method: 'POST',
        body: JSON.stringify({ rawText: rawInput }),
      });
    }
  },
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const data = await request(`/entries${qs ? `?${qs}` : ''}`);
    return data;
  },
  async get(id) {
    const data = await request(`/entries/${id}`);
    return data.entry || data;
  },
  async update(id, rawText) {
    return request(`/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ rawText }),
    });
  },
  async delete(id) {
    return request(`/entries/${id}`, { method: 'DELETE' });
  },
};

// ── Files ─────────────────────────────────────────────────
export const files = {
  async getUploadUrl(fileName, fileType, fileSize) {
    return request('/files/upload-url', {
      method: 'POST',
      body: JSON.stringify({ fileName, fileType, fileSize }),
    });
  },
  async confirm(fileKey, entryId) {
    return request('/files/confirm', {
      method: 'POST',
      body: JSON.stringify({ fileKey, entryId }),
    });
  },
  async upload(file) {
    // Full upload flow: get presigned URL → upload → confirm
    const { uploadUrl, fileKey } = await this.getUploadUrl(file.name, file.type, file.size);
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    return { fileKey, fileName: file.name, fileType: file.type, fileSize: file.size };
  },
};

// ── Plan / State ──────────────────────────────────────────
export const plan = {
  async today() { return request('/plan/today'); },
  async capacity() { return request('/capacity'); },
  async explain(itemId) { return request(`/explain/${itemId}`); },
};

export const actions = {
  async submit(itemId, type, snoozeMins = 180) {
    return request('/action', {
      method: 'POST',
      body: JSON.stringify({ itemId, type, snoozeMins }),
    });
  },
  async undo() { return request('/action/undo', { method: 'POST' }); },
  async history() { return request('/action/history'); },
};

// ── Stats ─────────────────────────────────────────────────
export const stats = {
  async get() { return request('/stats'); },
};

// ── Recall ────────────────────────────────────────────────
export const recall = {
  async query(question) {
    return request('/recall', {
      method: 'POST',
      body: JSON.stringify({ query: question }),
    });
  },
};

// ── Rules ─────────────────────────────────────────────────
export const rules = {
  async list() { return request('/rules'); },
  async create(rule) {
    return request('/rules', { method: 'POST', body: JSON.stringify(rule) });
  },
  async update(id, fields) {
    return request(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
  },
  async delete(id) {
    return request(`/rules/${id}`, { method: 'DELETE' });
  },
};

// ── Notifications ─────────────────────────────────────────
export const notifications = {
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/notifications${qs ? `?${qs}` : ''}`);
  },
  async markRead(id) {
    return request(`/notifications/${id}/read`, { method: 'POST' });
  },
  async markAllRead() {
    return request('/notifications/read-all', { method: 'POST' });
  },
};

// ── Billing ───────────────────────────────────────────────
export const billing = {
  async tier() { return request('/billing/tier'); },
};

// ── Profile ───────────────────────────────────────────────
export const profile = {
  async update(fields) {
    return request('/profile', { method: 'PATCH', body: JSON.stringify(fields) });
  },
};

export const platform = {
  async overview() { return request('/platform/overview'); },
  async roleDashboard(role) { return request(`/platform/dashboards/${role}`); },
  async accounts() { return request('/platform/accounts'); },
  async audit() { return request('/platform/audit'); },
  async schema() { return request('/platform/schema'); },
  async serviceHealth() { return request('/platform/service-health'); },
  async invite(email, role) {
    return request('/platform/invites', { method: 'POST', body: JSON.stringify({ email, role }) });
  },
  async grant(email, role) {
    return request('/platform/access/grant', { method: 'POST', body: JSON.stringify({ email, role }) });
  },
  async revoke(email) {
    return request('/platform/access/revoke', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async supportNote(email, note, category = 'diagnostic') {
    return request('/platform/support/notes', { method: 'POST', body: JSON.stringify({ email, note, category }) });
  },
  async exportRequest(email, reason) {
    return request('/platform/requests/export', { method: 'POST', body: JSON.stringify({ email, reason }) });
  },
  async deleteRequest(email, reason) {
    return request('/platform/requests/delete', { method: 'POST', body: JSON.stringify({ email, reason }) });
  },
  async backupRun() {
    return request('/platform/backups/run', { method: 'POST', body: JSON.stringify({}) });
  },
  async deployRun(environment = 'local', component = 'api', ref = 'context-package') {
    return request('/platform/deploys/run', { method: 'POST', body: JSON.stringify({ environment, component, ref }) });
  },
  async observabilityEvent(message, severity = 'info') {
    return request('/platform/observability/events', { method: 'POST', body: JSON.stringify({ message, severity, source: 'platform-console' }) });
  },
};

export default { auth, entries, files, plan, actions, stats, recall, rules, notifications, billing, profile, platform };
