/* global window, document */
// Apply before the application and its styles load, so the first paint uses the saved theme.
(() => {
  const key = 'pufu-lens-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  const readPreference = () => {
    try {
      const value = window.localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
      return 'system';
    }
  };
  let preference = readPreference();
  let snapshot;
  const apply = () => {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    if (snapshot?.preference === preference && snapshot.theme === theme) return;
    snapshot = { preference, theme };
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = theme === 'dark' ? '#101827' : '#fbfcff';
    try {
      // The server-rendered MCP consent page reads only this non-secret display preference.
      document.cookie = `pufu_lens_theme=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch {
      // Display preferences also work when cookies are blocked.
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101827' : '#233b63');
    listeners.forEach((listener) => listener());
  };
  window.pufuTheme = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPreference(value) {
      preference = value === 'light' || value === 'dark' ? value : 'system';
      try {
        window.localStorage.setItem(key, preference);
      } catch {
        // Keep the selection for this page even when browser storage is unavailable.
      }
      apply();
    },
  };
  media.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) {
      preference = readPreference();
      apply();
    }
  });
  apply();
})();
