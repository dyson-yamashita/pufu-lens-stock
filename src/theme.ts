import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeStore = {
  getSnapshot: () => { preference: ThemePreference; theme: 'light' | 'dark' };
  subscribe: (listener: () => void) => () => void;
  setPreference: (preference: ThemePreference) => void;
};

declare global {
  interface Window {
    pufuTheme: ThemeStore;
  }
}

export function useTheme() {
  return useSyncExternalStore(window.pufuTheme.subscribe, window.pufuTheme.getSnapshot);
}

export const setThemePreference = (preference: ThemePreference) =>
  window.pufuTheme.setPreference(preference);
