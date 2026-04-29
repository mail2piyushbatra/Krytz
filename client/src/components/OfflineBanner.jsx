import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useToast } from './Toast';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const toast = useToast();

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
      toast.error('You are offline. Changes will not be saved.', 0); // 0 = persistent until removed
    }

    function handleOnline() {
      setIsOffline(false);
      toast.success('Back online!', 3000);
      // We don't have a way to dismiss specific toasts from outside the toast API easily without keeping the ID, 
      // but the banner itself will disappear.
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [toast]);

  if (!isOffline) return null;

  return (
    <div style={{
      background: 'var(--danger-muted)',
      color: 'var(--danger)',
      padding: 'var(--space-2) var(--space-4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      fontSize: 'var(--text-sm)',
      fontWeight: 500,
      zIndex: 9999,
      position: 'relative'
    }} role="alert">
      <WifiOff size={16} />
      <span>No internet connection. Some features may be unavailable.</span>
    </div>
  );
}
