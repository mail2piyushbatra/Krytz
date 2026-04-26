/** ✦ FLOWRA — Settings Screen (Phase 1: export, delete account) */
import { useState, useEffect } from 'react';
import useAuthStore from '../stores/authStore';
import { profile, entries, billing } from '../services/api';
import './SettingsScreen.css';

export default function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tier, setTier] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await profile.update({ name: name.trim(), timezone });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const data = await entries.list({ limit: 10000 });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowra-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
    setExporting(false);
  }

  async function handleDeleteAccount() {
    const confirmed = prompt('Type "DELETE" to permanently delete your account and all data:');
    if (confirmed !== 'DELETE') return;
    try {
      // Try to call the delete endpoint
      const res = await fetch('http://localhost:3001/api/v1/auth/me', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('flowra_token')}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        logout();
      } else {
        alert('Failed to delete account');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // Load billing tier on mount
  useEffect(() => {
    billing.tier().then(t => setTier(t)).catch(() => {});
  }, []);

  return (
    <div className="page-container animate-fadeIn" id="settings-screen">
      <h1 className="page-title">Settings</h1>

      {/* Profile */}
      <section className="settings-section">
        <div className="section-title">Profile</div>
        <form className="settings-card card" onSubmit={handleSave}>
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
            <input
              className="input"
              type="email"
              value={user?.email || ''}
              disabled
              id="settings-email"
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">Timezone</label>
            <input
              className="input"
              type="text"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              placeholder="UTC"
              id="settings-timezone"
            />
          </div>
          <div className="settings-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving}
              id="settings-save"
            >
              {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Changes'}
            </button>
          </div>
        </form>
      </section>

      {/* Appearance */}
      <section className="settings-section">
        <div className="section-title">Appearance</div>
        <div className="settings-card card">
          <div className="settings-field">
            <label className="settings-label">Theme</label>
            <div className="theme-options">
              <button className="theme-option active" id="theme-dark">
                <span className="theme-dot" style={{ background: '#0a0a0f' }} />
                Dark
              </button>
              <button className="theme-option" disabled id="theme-light">
                <span className="theme-dot" style={{ background: '#f8f8fc' }} />
                Light (soon)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Billing tier */}
      {tier && (
        <section className="settings-section">
          <div className="section-title">Plan</div>
          <div className="settings-card card">
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
          </div>
        </section>
      )}

      {/* Data */}
      <section className="settings-section">
        <div className="section-title">Data</div>
        <div className="settings-card card">
          <div className="settings-data-row">
            <div>
              <div className="settings-data-label">Export All Data</div>
              <div className="settings-data-desc">Download all your entries as JSON</div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleExport}
              disabled={exporting}
              id="settings-export"
            >
              {exporting ? <span className="spinner" /> : '📥 Export JSON'}
            </button>
          </div>
        </div>
      </section>

      {/* Account Info */}
      <section className="settings-section">
        <div className="section-title">Account</div>
        <div className="settings-card card">
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
        </div>
      </section>

      {/* Danger Zone */}
      <section className="settings-section">
        <div className="section-title">Danger Zone</div>
        <div className="settings-card card settings-danger">
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
        </div>
      </section>
    </div>
  );
}
