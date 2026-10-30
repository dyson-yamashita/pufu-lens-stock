import { languages, resolveLanguage, type Language } from '../shared/locale';
import { t, useLanguage } from './i18n';

export default function LanguageSelect({
  id,
  value,
  onChange,
  disabled = false,
  hint = false,
}: {
  id: string;
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
  hint?: boolean;
}) {
  useLanguage();
  return (
    <div className="language-select">
      <label htmlFor={id}>{t('language.label')}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(resolveLanguage(event.target.value))}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {Object.entries(languages).map(([code, entry]) => (
          <option key={code} value={code} lang={code}>
            {entry.name}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="profile-hint">
          {t('language.hint')}
        </p>
      )}
    </div>
  );
}
