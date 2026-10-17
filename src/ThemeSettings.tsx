import { setThemePreference, useTheme, type ThemePreference } from './theme';

export default function ThemeSettings() {
  const { preference } = useTheme();
  const options: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'システムに合わせる' },
    { value: 'light', label: 'ライト' },
    { value: 'dark', label: 'ダーク' },
  ];
  return (
    <section className="profile-card appearance-settings" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">表示設定</h2>
      <fieldset className="theme-options" aria-describedby="theme-hint">
        <legend>カラーテーマ</legend>
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
        選ぶとすぐに反映されます。設定はこのブラウザに保存します。
      </p>
    </section>
  );
}
