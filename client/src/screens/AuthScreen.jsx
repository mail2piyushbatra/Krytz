/** ✦ FLOWRA — Auth Screen (Login / Register) */
import { useState } from 'react';
import useAuthStore from '../stores/authStore';
import './AuthScreen.css';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register, error, clearError } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
    } catch { /* error set in store */ }
    setLoading(false);
  };

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login');
    clearError();
  };

  return (
    <div className="auth-bg" id="auth-screen">
      <div className="auth-gradient" />
      <div className="auth-gradient auth-gradient-2" />

      <form className="auth-card glass animate-scaleIn" onSubmit={handleSubmit}>
        <div className="auth-logo">
          <span className="auth-logo-mark">✦</span>
          <h1 className="auth-logo-text">flowra</h1>
        </div>
        <p className="auth-tagline">Your life, reconstructed.</p>

        {error && <div className="auth-error animate-slideDown">{error}</div>}

        {mode === 'register' && (
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            id="auth-name"
          />
        )}

        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          id="auth-email"
        />

        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          id="auth-password"
        />

        <button
          className="btn btn-primary btn-lg auth-submit"
          type="submit"
          disabled={loading}
          id="auth-submit"
        >
          {loading ? (
            <span className="auth-spinner" />
          ) : (
            <>{mode === 'login' ? 'Sign In' : 'Create Account'} →</>
          )}
        </button>

        <p className="auth-switch">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" className="auth-switch-btn" onClick={toggleMode}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}
