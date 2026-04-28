/** ✦ FLOWRA — useTheme hook
 *  Persists theme preference in localStorage.
 *  Applies [data-theme] on <html> — zero component changes needed.
 */
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'flowra_theme';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Update theme-color meta for iOS browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0E1117' : '#FAF8F5';
  }, [theme]);

  function toggle() {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }

  return { theme, toggle, isDark: theme === 'dark' };
}
