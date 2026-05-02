/** Krytz — Auth Screen (Login / Register / Reset / Google) */
import { useState, useEffect, useRef } from 'react';
import useAuthStore from '../stores/authStore';
import { auth } from '../services/api';
import { ActionBtn } from '../components/ui/UiKit';
import './AuthScreen.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
  || '692406372365-jds36ljd41fkocssm4a0vpo26vekid2i.apps.googleusercontent.com';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login', 'register', 'forgot', 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const googleBtnRef = useRef(null);

  const { login, register, loginWithGoogle, error, clearError } = useAuthStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('resetToken');
    if (token) {
      setResetToken(token);
      setMode('reset');
    }
  }, []);

  // Render Google sign-in button when on login/register modes.
  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return;
    let cancelled = false;

    loadGoogleScript()
      .then((google) => {
        if (cancelled || !google?.accounts?.id || !googleBtnRef.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              setLocalError('');
              setLoading(true);
              await loginWithGoogle(response.credential);
            } catch (err) {
              setLocalError(err.message || 'Google sign-in failed.');
            } finally {
              setLoading(false);
            }
          },
        });
        // Clear any previous render before re-rendering on mode flip
        googleBtnRef.current.innerHTML = '';
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
          text: mode === 'register' ? 'signup_with' : 'signin_with',
        });
      })
      .catch(() => {
        // Network blocked / offline — leave the slot empty rather than crashing.
      });

    return () => { cancelled = true; };
  }, [mode, loginWithGoogle]);

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

  return (
    <div className="auth-bg" id="auth-screen">
      <div className="auth-gradient" />
      <div className="auth-gradient auth-gradient-2" />

      <form className="auth-card glass animate-scaleIn" onSubmit={handleSubmit}>
        <div className="auth-logo">
          <span className="auth-logo-mark">✦</span>
          <h1 className="auth-logo-text">Krytz</h1>
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
            <div className="oauth-buttons" style={{ justifyContent: 'center' }}>
              <div ref={googleBtnRef} />
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
          <p className="auth-legal">
            By continuing you agree to our{' '}
            <a href="/terms" className="auth-legal-link">Terms</a>{' '}and{' '}
            <a href="/privacy" className="auth-legal-link">Privacy Policy</a>.
          </p>
        </div>
      </form>
    </div>
  );
}
