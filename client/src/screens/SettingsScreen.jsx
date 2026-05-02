/** ✦ Krytz — Settings Screen
 *
 * Profile (name, timezone picker), category management (CRUD),
 * data export, account management, appearance.
 */
import { useState, useEffect, useRef } from 'react';
import useAuthStore from '../stores/authStore';
import { API_BASE, profile, billing, categories as catApi, dataExport, rules as rulesApi } from '../services/api';
import { useTheme } from '../hooks/useTheme';
import { Card, ActionBtn, Badge } from '../components/ui/UiKit';
import { useToast } from '../components/Toast';
import './SettingsScreen.css';

// ── Common timezones grouped by region ────────────────────────
const TIMEZONE_GROUPS = {
  'Americas': [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Mexico_City',
  ],
  'Europe': [
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
    'Europe/Istanbul', 'Europe/Amsterdam', 'Europe/Rome', 'Europe/Madrid',
  ],
  'Asia': [
    'Asia/Kolkata', 'Asia/Dubai', 'Asia/Shanghai', 'Asia/Tokyo',
    'Asia/Singapore', 'Asia/Seoul', 'Asia/Hong_Kong', 'Asia/Bangkok',
  ],
  'Pacific & Africa': [
    'Australia/Sydney', 'Pacific/Auckland', 'Africa/Cairo',
    'Africa/Lagos', 'Africa/Johannesburg', 'Pacific/Honolulu',
  ],
  'UTC': ['UTC'],
};

const COLOR_PALETTE = [
  '#4B7BD4', '#C8A45A', '#9B6BD4', '#4B9B6B', '#D49B4B',
  '#D4574B', '#5B8EC9', '#7BC86C', '#F5DD29', '#FFAF3F',
  '#EB5A46', '#C377E0', '#00C2E0', '#51E898', '#FF78CB',
];

export default function SettingsScreen() {
  const { user, logout, updateUser } = useAuthStore();
  const { theme, toggle: toggleTheme } = useTheme();
  const [name, setName] = useState(user?.name || '');
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [tier, setTier] = useState(null);
  const [categories, setCategories] = useState([]);
  const [editingCat, setEditingCat] = useState(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(COLOR_PALETTE[0]);
  const [catLoading, setCatLoading] = useState(false);
  const [rulesList, setRulesList] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [addingRule, setAddingRule] = useState(false);
  const toast = useToast();

  // Load categories
  useEffect(() => {
    catApi.list()
      .then(res => setCategories((res?.categories || []).filter(c => c.id)))
      .catch(() => {});
    billing.tier().then(t => setTier(t)).catch(() => {});
    loadRules();
  }, []);

  async function loadRules() {
    setRulesLoading(true);
    try {
      const data = await rulesApi.list();
      setRulesList(data?.rules || []);
    } catch { setRulesList([]); }
    setRulesLoading(false);
  }

  async function handleCreateRule(e) {
    e.preventDefault();
    if (!newRule.trim()) return;
    setAddingRule(true);
    try {
      await rulesApi.create({ nl: newRule.trim() });
      setNewRule('');
      await loadRules();
      toast.success('Rule created');
    } catch (err) { toast.error(err.message || 'Rule creation failed'); }
    setAddingRule(false);
  }

  async function handleToggleRule(id, enabled) {
    try {
      await rulesApi.update(id, { enabled: !enabled });
      setRulesList(prev => prev.map(r => r.id === id ? { ...r, enabled: !enabled } : r));
    } catch (err) { toast.error(err.message); }
  }

  async function handleDeleteRule(id, name) {
    if (!confirm(`Delete rule "${name}"?`)) return;
    try {
      await rulesApi.delete(id);
      setRulesList(prev => prev.filter(r => r.id !== id));
      toast.success('Rule deleted');
    } catch (err) { toast.error(err.message); }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await profile.update({ name: name.trim(), timezone });
      // Refresh the in-memory user so sidebar/avatar updates instantly
      updateUser(data?.user || { name: name.trim(), timezone });
      setSaved(true);
      toast.success('Profile saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (!currentPassword || newPassword.length < 8) return;
    setChangingPwd(true);
    try {
      await profile.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Password updated');
    } catch (err) { toast.error(err.message); }
    setChangingPwd(false);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await dataExport.download();
      toast.success('JSON export downloaded');
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    }
    setExporting(false);
  }

  async function handleExportCSV() {
    setExportingCSV(true);
    try {
      const result = await dataExport.downloadCSV();
      toast.success(`CSV downloaded (${result.count} items)`);
    } catch (err) {
      toast.error('CSV export failed: ' + err.message);
    }
    setExportingCSV(false);
  }

  async function handleDeleteAccount() {
    const confirmed = prompt('Type "DELETE" to permanently delete your account and all data:');
    if (confirmed !== 'DELETE') return;
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('Krytz_token')}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) { logout(); }
      else { toast.error('Failed to delete account'); }
    } catch (err) { toast.error('Error: ' + err.message); }
  }

  // ── Category CRUD ─────────────────────────────────────────────

  async function handleCreateCategory(e) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCatLoading(true);
    try {
      await catApi.create({ name: newCatName.trim(), color: newCatColor });
      setNewCatName('');
      const res = await catApi.list();
      setCategories((res?.categories || []).filter(c => c.id));
      toast.success(`Category "${newCatName.trim()}" created`);
    } catch (err) { toast.error(err.message); }
    setCatLoading(false);
  }

  async function handleUpdateCategory(id, updates) {
    try {
      await catApi.update(id, updates);
      const res = await catApi.list();
      setCategories((res?.categories || []).filter(c => c.id));
      setEditingCat(null);
      toast.success('Category updated');
    } catch (err) { toast.error(err.message); }
  }

  async function handleDeleteCategory(id, name) {
    if (!confirm(`Delete "${name}"? Items will move to uncategorized.`)) return;
    try {
      await catApi.remove(id);
      const res = await catApi.list();
      setCategories((res?.categories || []).filter(c => c.id));
      toast.success(`Category "${name}" deleted`);
    } catch (err) { toast.error(err.message); }
  }

  const enabledRules = rulesList.filter(rule => rule.enabled).length;
  const planName = tier?.tier || tier?.name || 'free';
  const captureUsage = tier?.captures_today !== undefined
    ? `${tier.captures_today}/${tier.max_daily_captures || 'unlimited'}`
    : 'open';

  return (
    <div className="page-container animate-fadeIn" id="settings-screen">
      <h1 className="page-title">Settings</h1>

      <section className="settings-kpi-grid" aria-label="Settings dashboard">
        <SettingsKpiCard label="Plan" value={planName} detail={`captures ${captureUsage}`} />
        <SettingsKpiCard label="Categories" value={categories.length} detail="active routing lanes" />
        <SettingsKpiCard label="Rules" value={rulesList.length} detail={`${enabledRules} enabled`} />
        <SettingsKpiCard label="Theme" value={theme} detail={`${timezone} timezone`} />
      </section>

      {/* Profile */}
      <section className="settings-section">
        <div className="section-title">Profile</div>
        <Card as="form" onSubmit={handleSave}>
          <div className="settings-field">
            <label className="settings-label">Name</label>
            <input
              className="input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              id="settings-name"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">Email</label>
            <input className="input" type="email" value={user?.email || ''} disabled id="settings-email" />
          </div>
          <div className="settings-field">
            <label className="settings-label">Timezone</label>
            <select
              className="input settings-timezone-select"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              id="settings-timezone"
            >
              {Object.entries(TIMEZONE_GROUPS).map(([group, zones]) => (
                <optgroup key={group} label={group}>
                  {zones.map(tz => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="settings-tz-hint">
              Current: {new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
            </span>
          </div>
          <div className="settings-actions">
            <ActionBtn variant="primary" type="submit" isLoading={saving} isSuccess={saved} id="settings-save">
              Save Changes
            </ActionBtn>
          </div>
        </Card>

        <Card as="form" style={{ marginTop: 'var(--space-4)' }} onSubmit={handleChangePassword}>
          <div className="section-title" style={{ fontSize: '1rem', marginTop: 0 }}>Change Password</div>
          <div className="settings-field">
            <label className="settings-label">Current Password</label>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">New Password</label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              minLength={8}
              required
            />
          </div>
          <div className="settings-actions">
            <ActionBtn variant="secondary" type="submit" isLoading={changingPwd} disabled={!currentPassword || newPassword.length < 8}>
              Update Password
            </ActionBtn>
          </div>
        </Card>
      </section>

      {/* Category Management */}
      <section className="settings-section">
        <div className="section-title">Categories</div>
        <Card>
          <div className="cat-list">
            {categories.map(cat => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                editing={editingCat === cat.id}
                onEdit={() => setEditingCat(editingCat === cat.id ? null : cat.id)}
                onUpdate={(updates) => handleUpdateCategory(cat.id, updates)}
                onDelete={() => handleDeleteCategory(cat.id, cat.name)}
              />
            ))}
            {categories.length === 0 && (
              <p className="cat-empty">No categories yet. Create one below.</p>
            )}
          </div>
          <form className="cat-create-form" onSubmit={handleCreateCategory}>
            <div className="cat-color-pick">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`cat-color-dot ${newCatColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewCatColor(c)}
                />
              ))}
            </div>
            <div className="cat-create-row">
              <input
                className="input"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="New category name..."
              />
              <ActionBtn variant="primary" type="submit" isLoading={catLoading} disabled={!newCatName.trim()}>
                Add
              </ActionBtn>
            </div>
          </form>
        </Card>
      </section>

      {/* Billing tier */}
      {tier && (
        <section className="settings-section">
          <div className="section-title">Plan</div>
          <Card>
            <div className="settings-info-row">
              <span className="settings-info-label">Current Plan</span>
              <span className="badge badge-tag" style={{ textTransform: 'uppercase' }}>{tier.tier || tier.name || 'free'}</span>
            </div>
            {tier.captures_today !== undefined && (
              <div className="settings-info-row">
                <span className="settings-info-label">Captures today</span>
                <span className="settings-info-value">{tier.captures_today} / {tier.max_daily_captures || '∞'}</span>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Appearance */}
      <section className="settings-section">
        <div className="section-title">Appearance</div>
        <Card>
          <div className="settings-field">
            <label className="settings-label">Theme</label>
            <div className="theme-options">
              <button
                className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => theme !== 'light' && toggleTheme()}
                id="theme-light"
              >
                <span className="theme-dot" style={{ background: '#FAF8F5', border: '1px solid #ddd' }} />
                ☀ Cream (Light)
              </button>
              <button
                className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => theme !== 'dark' && toggleTheme()}
                id="theme-dark"
              >
                <span className="theme-dot" style={{ background: '#0E1117' }} />
                ◑ Obsidian (Dark)
              </button>
            </div>
          </div>
        </Card>
      </section>

      {/* Data */}
      <section className="settings-section">
        <div className="section-title">Data</div>
        <Card>
          <div className="settings-data-row">
            <div>
              <div className="settings-data-label">Export All Data</div>
              <div className="settings-data-desc">Download all your data as a file</div>
            </div>
            <button className="btn btn-secondary" onClick={handleExport} disabled={exporting} id="settings-export">
              {exporting ? <span className="spinner" /> : '📥 JSON'}
            </button>
          </div>
          <div className="settings-data-row">
            <div>
              <div className="settings-data-label">Export Items as CSV</div>
              <div className="settings-data-desc">Download your tasks as a spreadsheet</div>
            </div>
            <ActionBtn variant="secondary" onClick={handleExportCSV} isLoading={exportingCSV} id="settings-export-csv">
              Export CSV
            </ActionBtn>
          </div>
        </Card>
      </section>

      {/* Rules */}
      <section className="settings-section">
        <div className="section-title">Smart Rules</div>
        <Card>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Describe a rule in plain English — e.g. "If an item is older than 7 days and open, mark it as stalled."
          </p>

          {/* Existing rules */}
          {rulesLoading ? (
            <div className="skeleton" style={{ height: 40, marginBottom: 12 }} />
          ) : rulesList.length === 0 ? (
            <p className="cat-empty">No rules yet. Add one below.</p>
          ) : (
            <div className="cat-list" style={{ marginBottom: 'var(--space-4)' }}>
              {rulesList.map(rule => (
                <div key={rule.id} className="cat-row">
                  <span
                    className="cat-dot-lg"
                    style={{ background: rule.enabled ? 'var(--status-done)' : 'var(--text-tertiary)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cat-row-name">{rule.name || rule.nl_input || 'Unnamed rule'}</div>
                    {rule.nl_input && rule.name && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {rule.nl_input}
                      </div>
                    )}
                  </div>
                  <div className="cat-row-actions" style={{ opacity: 1 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleToggleRule(rule.id, rule.enabled)}
                      title={rule.enabled ? 'Disable' : 'Enable'}
                    >
                      {rule.enabled ? 'On' : 'Off'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDeleteRule(rule.id, rule.name || 'this rule')}
                      style={{ color: 'var(--danger)' }}
                    >×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create new rule */}
          <form onSubmit={handleCreateRule} style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              className="input"
              placeholder='e.g. "If blocker is older than 3 days, send a reminder"'
              value={newRule}
              onChange={e => setNewRule(e.target.value)}
              style={{ flex: 1 }}
              id="new-rule-input"
            />
            <ActionBtn variant="primary" className="btn-sm" type="submit" isLoading={addingRule} disabled={!newRule.trim()}>
              Add Rule
            </ActionBtn>
          </form>
        </Card>
      </section>

      {/* Account Info */}
      <section className="settings-section">
        <div className="section-title">Account</div>
        <Card>
          <div className="settings-info-row">
            <span className="settings-info-label">User ID</span>
            <span className="settings-info-value">{user?.id?.slice(0, 16)}...</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">Member since</span>
            <span className="settings-info-value">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
            </span>
          </div>
        </Card>
      </section>

      {/* Danger Zone */}
      <section className="settings-section">
        <div className="section-title">Danger Zone</div>
        <Card className="settings-danger">
          <div className="settings-data-row">
            <div>
              <div className="settings-data-label">Sign Out</div>
              <div className="settings-data-desc">Log out of your account</div>
            </div>
            <button className="btn btn-secondary" onClick={logout} id="settings-logout">
              Sign Out
            </button>
          </div>
          <div className="settings-data-row">
            <div>
              <div className="settings-data-label" style={{ color: 'var(--danger)' }}>Delete Account</div>
              <div className="settings-data-desc">Permanently delete your account and all data</div>
            </div>
            <button className="btn btn-danger" onClick={handleDeleteAccount} id="settings-delete-account">
              Delete Account
            </button>
          </div>
        </Card>
      </section>
    </div>
  );
}

// ─── Category Row ──────────────────────────────────────────────────────────────

function SettingsKpiCard({ label, value, detail }) {
  return (
    <article className="settings-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CategoryRow({ cat, editing, onEdit, onUpdate, onDelete }) {
  const [editName, setEditName] = useState(cat.name);
  const [editColor, setEditColor] = useState(cat.color);
  const nameRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setEditName(cat.name);
      setEditColor(cat.color);
      setTimeout(() => nameRef.current?.focus(), 30);
    }
  }, [editing, cat.name, cat.color]);

  function handleSave() {
    const updates = {};
    if (editName.trim() !== cat.name) updates.name = editName.trim();
    if (editColor !== cat.color) updates.color = editColor;
    if (Object.keys(updates).length > 0) onUpdate(updates);
    else onEdit(); // close
  }

  return (
    <div className="cat-row">
      <span className="cat-dot-lg" style={{ background: editing ? editColor : cat.color }} />
      {editing ? (
        <div className="cat-edit-form">
          <input
            ref={nameRef}
            className="input cat-edit-name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onEdit(); }}
          />
          <div className="cat-color-pick cat-color-pick-sm">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                type="button"
                className={`cat-color-dot ${editColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setEditColor(c)}
              />
            ))}
          </div>
          <div className="cat-edit-actions">
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <span className="cat-row-name">{cat.name}</span>
          {cat.itemCounts && (
            <span className="cat-row-count">
              {(cat.itemCounts.open || 0) + (cat.itemCounts.inProgress || 0)} active
            </span>
          )}
          <div className="cat-row-actions">
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
            <button className="btn btn-ghost btn-sm" onClick={onDelete} style={{ color: 'var(--danger)' }}>×</button>
          </div>
        </>
      )}
    </div>
  );
}
