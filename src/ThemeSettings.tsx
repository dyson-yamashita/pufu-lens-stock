import { t, useLanguage } from './i18n';
import { setThemePreference, useTheme, type ThemePreference } from './theme';
export default function ThemeSettings() {
  useLanguage();
  const { preference } = useTheme();
  const options: {
    value: ThemePreference;
    label: string;
  }[] = [
    { value: 'system', label: t('ui.theme_settings.use_system_setting') },
    { value: 'light', label: t('ui.theme_settings.light') },
    { value: 'dark', label: t('ui.theme_settings.dark') },
  ];
  return (
    <section className="profile-card appearance-settings" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">{t('ui.theme_settings.display_settings')}</h2>
      <fieldset className="theme-options" aria-describedby="theme-hint">
        <legend>{t('ui.theme_settings.color_theme')}</legend>
        {options.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => setThemePreference(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p id="theme-hint" className="field-hint">
        {t('ui.theme_settings.applied_immediately_this_setting_is_saved_in_this_browser')}
      </p>
    </section>
  );
}
