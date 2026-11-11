import { Moon, Sun } from 'lucide-react';
import { t, useLanguage } from './i18n';
import { setThemePreference, useTheme } from './theme';

export default function ThemeToggle() {
  useLanguage();
  const { theme } = useTheme();
  return (
    <button
      className="theme-toggle"
      type="button"
      role="switch"
      aria-label={t('ui.theme_settings.dark_mode')}
      aria-checked={theme === 'dark'}
      onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="theme-toggle-light" size={14} aria-hidden="true" />
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <Moon className="theme-toggle-dark" size={14} aria-hidden="true" />
    </button>
  );
}
