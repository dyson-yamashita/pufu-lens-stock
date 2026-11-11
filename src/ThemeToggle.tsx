import { Moon, Sun } from 'lucide-react';
import { t, useLanguage } from './i18n';
import { setThemePreference, useTheme } from './theme';

export default function ThemeToggle() {
  useLanguage();
  const { theme } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label={t('ui.theme_settings.color_theme')}>
      <button
        type="button"
        aria-label={t('ui.theme_settings.light')}
        title={t('ui.theme_settings.light')}
        aria-pressed={theme === 'light'}
        onClick={() => setThemePreference('light')}
      >
        <Sun size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t('ui.theme_settings.dark')}
        title={t('ui.theme_settings.dark')}
        aria-pressed={theme === 'dark'}
        onClick={() => setThemePreference('dark')}
      >
        <Moon size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
