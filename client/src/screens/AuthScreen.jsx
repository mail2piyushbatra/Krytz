/** ✦ FLOWRA — Auth Screen (Login / Register / Reset) */
import { useState, useEffect } from 'react';
import useAuthStore from '../stores/authStore';
import { auth } from '../services/api';
import { ActionBtn } from '../components/ui/UiKit';
import './AuthScreen.css';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login', 'register', 'forgot', 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const { login, register, error, clearError } = useAuthStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('resetToken');
    if (token) {
      setResetToken(token);
      setMode('reset');
    }
  }, []);

  const validate = () => {
    setLocalError('');
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setLocalError('Please enter a valid email address.');
      return false;
    }
    if ((mode === 'register' || mode === 'reset') && password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    setSuccessMsg('');
    
    if (!validate()) return;
    
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else if (mode === 'register') await register(email, password, name);
      else if (mode === 'forgot') {
        const res = await auth.forgotPassword(email);
        setSuccessMsg(res.message || 'If that email exists, a reset link has been sent.');
      } else if (mode === 'reset') {
        await auth.resetPassword(resetToken, password);
        setSuccessMsg('Password reset successfully. You can now log in.');
        setTimeout(() => setMode('login'), 2000);
      }
    } catch (err) {
      setLocalError(err.message || 'An error occurred.');
    }
    setLoading(false);
  };

  const toggleMode = (newMode) => {
    setMode(newMode);
    clearError();
    setLocalError('');
    setSuccessMsg('');
  };

  const handleOAuth = (provider) => {
    alert(`OAuth with ${provider} is coming in Phase 3!`);
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
        <p className="auth-tagline">
          {mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Create new password' : 'Your life, reconstructed.'}
        </p>

        {(error || localError) && <div className="auth-error animate-slideDown">{error || localError}</div>}
        {successMsg && <div className="auth-success animate-slideDown">{successMsg}</div>}

        {mode === 'register' && (
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => { setName(e.target.value); setLocalError(''); }}
            autoComplete="name"
          />
        )}

        {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => { setEmail(e.target.value); setLocalError(''); }}
            required
            autoComplete="email"
          />
        )}

        {(mode === 'login' || mode === 'register' || mode === 'reset') && (
          <input
            className="input"
            type="password"
            placeholder={mode === 'reset' ? 'New Password' : 'Password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setLocalError(''); }}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        )}

        <ActionBtn
          className="btn-lg auth-submit"
          type="submit"
          isLoading={loading}
        >
          {mode === 'login' && 'Sign In'}
          {mode === 'register' && 'Create Account'}
          {mode === 'forgot' && 'Send Reset Link'}
          {mode === 'reset' && 'Update Password'}
        </ActionBtn>

        {(mode === 'login' || mode === 'register') && (
          <>
            <div className="auth-divider"><span>or continue with</span></div>
            <div className="oauth-buttons">
              <button type="button" className="btn btn-oauth" onClick={() => handleOAuth('Google')}>
                <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" alt="G" className="oauth-icon" />
                Google
              </button>
              <button type="button" className="btn btn-oauth" onClick={() => handleOAuth('Apple')}>
                <svg viewBox="0 0 384 512" className="oauth-icon apple-icon" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                Apple
              </button>
            </div>
          </>
        )}

        <div className="auth-footer-links">
          {mode === 'login' ? (
            <>
              <p className="auth-switch">Don't have an account? <button type="button" className="auth-switch-btn" onClick={() => toggleMode('register')}>Sign up</button></p>
              <button type="button" className="auth-forgot-btn" onClick={() => toggleMode('forgot')}>Forgot password?</button>
            </>
          ) : mode === 'register' ? (
            <p className="auth-switch">Already have an account? <button type="button" className="auth-switch-btn" onClick={() => toggleMode('login')}>Sign in</button></p>
          ) : (
            <button type="button" className="auth-switch-btn" onClick={() => toggleMode('login')}>← Back to login</button>
          )}
        </div>
      </form>
    </div>
  );
}
