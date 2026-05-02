/** âœ¦ Krytz â€” API Client
 *  Connects to the Express backend (default: localhost:8301).
 *  Handles JWT auth, auto-refresh, and response unwrapping.
 */

// Default to local dev API when running on localhost; otherwise hit the deployed Railway backend.
// Override either by setting VITE_API_URL at build time.
const isLocal = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
const DEFAULT_API = isLocal
  ? 'http://localhost:8301/api/v1'
  : 'https://krytzserver-production.up.railway.app/api/v1';
export const API_BASE = import.meta.env.VITE_API_URL || DEFAULT_API;

let accessToken = localStorage.getItem('Krytz_token');
let refreshToken = localStorage.getItem('Krytz_refresh');
let onUnauthorized = null;

export function setAuthCallback(cb) { onUnauthorized = cb; }

function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('Krytz_token', access);
  else localStorage.removeItem('Krytz_token');
  if (refresh) localStorage.setItem('Krytz_refresh', refresh);
  else localStorage.removeItem('Krytz_refresh');
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

  // Unwrap { success, data } envelope used by API routes
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

// â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  async loginWithGoogle(idToken) {
    const data = await request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
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
  async forgotPassword(email) {
    const data = await request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return data;
  },
  async resetPassword(token, newPassword) {
    const data = await request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
    return data;
  },
};

// â”€â”€ Capture / Entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const entries = {
  /**
   * Free-form capture â†’ /capture (AI pipeline, async 202).
   * Structured types (todo/done/blocked/note) â†’ /entries (instant handling).
   */
  async capture(rawInput, opts = {}) {
    const type = opts.type || 'capture';
    if (type === 'capture') {
      // AI-pipeline path â€” POST /capture
      return request('/capture', {
        method: 'POST',
        body: JSON.stringify({ raw_input: rawInput, source: 'manual', ...opts }),
      });
    }
    // Structured type â€” direct entry with instant state handling
    return request('/entries', {
      method: 'POST',
      body: JSON.stringify({ rawText: rawInput, type, category: opts.category }),
    });
  },
  /** Direct todo items â€” skips LLM, zero latency */
  async todo(rawInput, category) {
    return this.capture(rawInput, { type: 'todo', category });
  },
  /** Mark something as done â€” instant state update */
  async done(rawInput, category) {
    return this.capture(rawInput, { type: 'done', category });
  },
  /** Flag something as blocked â€” instant state update */
  async blocked(rawInput, category) {
    return this.capture(rawInput, { type: 'blocked', category });
  },
  /** Store a note â€” no extraction, pure journal */
  async note(rawInput, category) {
    return this.capture(rawInput, { type: 'note', category });
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

// â”€â”€ Files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // Full upload flow: get presigned URL â†’ upload â†’ confirm
    const { uploadUrl, fileKey } = await this.getUploadUrl(file.name, file.type, file.size);
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    return { fileKey, fileName: file.name, fileType: file.type, fileSize: file.size };
  },
};

// â”€â”€ Plan / State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const plan = {
  async today() { return request('/plan/today'); },
  async week()  { return request('/intelligence/plan/week'); },
  async explain(itemId) { return request(`/explain/${itemId}`); },
  // capacity lives under /intelligence/capacity, NOT /capacity
  async capacity() { return request('/intelligence/capacity'); },
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
  async feedback(type, targetType, targetId, reason) {
    return request('/feedback', { method: 'POST', body: JSON.stringify({ type, targetType, targetId, reason }) });
  },
};

// â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const stats = {
  async get() { return request('/stats'); },
};

// â”€â”€ Intelligence (advanced features) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const intelligence = {
  async contradictions()             { return request('/intelligence/contradictions'); },
  async resolveContradiction(id)     { return request(`/intelligence/contradictions/${id}/resolve`, { method: 'POST' }); },
  async commitments()                { return request('/intelligence/commitments'); },
  async fulfillCommitment(id)        { return request(`/intelligence/commitments/${id}/fulfill`, { method: 'POST' }); },
  async simulate(mutation)           { return request('/intelligence/simulate', { method: 'POST', body: JSON.stringify({ mutation }) }); },
  async estimateTime(itemId)         { return request(`/intelligence/items/${itemId}/estimate`); },
  async recordTime(itemId, mins)     { return request(`/intelligence/items/${itemId}/time`, { method: 'POST', body: JSON.stringify({ actualMins: mins }) }); },
  async estimationStats()            { return request('/intelligence/estimation/stats'); },
  async taskGraph(limit = 36)         { return request(`/intelligence/task-graph?limit=${limit}`); },
  async weeklyMemory(days = 7, limit = 18) { return request(`/intelligence/weekly-memory?days=${days}&limit=${limit}`); },
  // /metrics/* routes are on productRoutesV2, not /intelligence prefix
  async metricsSuggestions(days = 7) { return request(`/metrics/suggestions?days=${days}`); },
  async metricsCosts()               { return request('/metrics/costs'); },
};

// â”€â”€ Recall â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const recall = {
  async query(question) {
    return request('/recall', {
      method: 'POST',
      body: JSON.stringify({ query: question }),
    });
  },
};

// â”€â”€ Rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Billing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lives under /intelligence/billing/tier, NOT /billing/tier
export const billing = {
  async tier() { return request('/intelligence/billing/tier'); },
  async checkout(priceId, successUrl, cancelUrl) {
    return request('/intelligence/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    });
  },
};

// â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const profile = {
  async update(fields) {
    // Backend route is PATCH /auth/me, not /profile
    return request('/auth/me', { method: 'PATCH', body: JSON.stringify(fields) });
  },
  async changePassword(currentPassword, newPassword) {
    return request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
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

// â”€â”€ Items (Todo Ledger) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const items = {
  async list(filters = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null) params.set(k, v);
    }
    const qs = params.toString();
    return request(`/items${qs ? '?' + qs : ''}`);
  },
  async get(id) { return request(`/items/${id}`); },
  async create(data) {
    return request('/items', { method: 'POST', body: JSON.stringify(data) });
  },
  async update(id, updates) {
    return request(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
  },
  async remove(id) {
    return request(`/items/${id}`, { method: 'DELETE' });
  },
  async completions(days = 7) {
    return request(`/items/completions?days=${days}`);
  },
  // Convenience: mark done
  async markDone(id) {
    return request(`/items/${id}`, { method: 'PATCH', body: JSON.stringify({ state: 'DONE' }) });
  },
  // Convenience: toggle blocker
  async toggleBlocker(id, isBlocked) {
    return request(`/items/${id}`, { method: 'PATCH', body: JSON.stringify({ blocker: isBlocked }) });
  },
  // Semantic vector search
  async semanticSearch(query, limit = 10) {
    return request('/items/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    });
  },
};

// â”€â”€ Categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const categories = {
  async list() { return request('/categories'); },
  async create(data) {
    return request('/categories', { method: 'POST', body: JSON.stringify(data) });
  },
  async update(id, updates) {
    return request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
  },
  async remove(id) {
    return request(`/categories/${id}`, { method: 'DELETE' });
  },
};

// â”€â”€ Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const analytics = {
  async overview() { return request('/analytics/overview'); },
  async category(name) { return request(`/analytics/category/${encodeURIComponent(name)}`); },
};

// â”€â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const dataExport = {
  async download() {
    const res = await request('/export');
    // Trigger browser download
    const blob = new Blob([JSON.stringify(res.data || res, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Krytz-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return res;
  },

  async downloadCSV() {
    const res = await request('/export');
    const data = res.data || res;
    // Build CSV from items array
    const items = data.items || [];
    const headers = ['id', 'text', 'state', 'category', 'blocker', 'priority', 'dueDate', 'createdAt'];
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      headers.join(','),
      ...items.map(it => headers.map(h =>
        escape(h === 'text' ? (it.canonical_text || it.text || '') : it[h])
      ).join(',')),
    ];
    const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Krytz-items-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return { count: items.length };
  },
};

// â”€â”€ Inspector (observability & engine introspection) â”€â”€â”€â”€â”€â”€â”€
export const tools = {
  async execute(type, payload = {}, source = 'client') {
    return request('/tools/execute', { method: 'POST', body: JSON.stringify({ type, payload, source }) });
  },
  async history(limit = 50) {
    return request(`/tools/history?limit=${limit}`);
  },
};

export const inspector = {
  async traces(limit = 50)       { return request(`/inspector/traces?limit=${limit}`); },
  async replay(traceId)          { return request(`/inspector/replay/${traceId}`); },
  async anomalies(limit = 30)    { return request(`/inspector/anomalies?limit=${limit}`); },
  async decisions(limit = 30)    { return request(`/inspector/decisions?limit=${limit}`); },
  async graph()                  { return request('/inspector/graph'); },
  async health()                 { return request('/inspector/health'); },
  async connectors()             { return request('/inspector/connectors'); },
  async registerConnector(platform, config = {}) {
    return request('/inspector/connectors', { method: 'POST', body: JSON.stringify({ platform, config }) });
  },
  async syncConnector(platform, options = {}) {
    return request(`/inspector/connectors/${platform}/sync`, { method: 'POST', body: JSON.stringify(options) });
  },
  async disconnectConnector(platform) {
    return request(`/inspector/connectors/${platform}`, { method: 'DELETE' });
  },
};

export default { auth, entries, files, plan, actions, stats, recall, rules, notifications, billing, profile, platform, items, categories, analytics, dataExport, tools, intelligence, inspector };
