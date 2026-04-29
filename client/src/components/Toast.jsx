/** ✦ FLOWRA — Global Toast System
 *
 *  Usage from any component:
 *    import { useToast } from '../components/Toast';
 *    const toast = useToast();
 *    toast.success('Saved!');
 *    toast.error('Something went wrong');
 *    toast.info('Uploading...');
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import './Toast.css';

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const api = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error', dur || 5000),
    info:    (msg, dur) => addToast(msg, 'info', dur),
    remove:  removeToast,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-label="Notifications">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback if used outside provider — won't crash, just logs
    return {
      success: (msg) => console.log('[toast]', msg),
      error:   (msg) => console.error('[toast]', msg),
      info:    (msg) => console.info('[toast]', msg),
      remove:  () => {},
    };
  }
  return ctx;
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.type] || Info;
  return (
    <div className={`toast-item toast-${toast.type}`} role="alert">
      <Icon size={18} className="toast-icon" aria-hidden="true" />
      <span className="toast-message">{toast.message}</span>
      <button className="toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
