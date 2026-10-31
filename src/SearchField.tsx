import { t, useLanguage } from './i18n';
import { useRef } from 'react';
import { Search, X } from 'lucide-react';
export default function SearchField({
  label,
  placeholder,
  value,
  clearable,
  onChange,
  onSearch,
  onClear,
}: {
  label: string;
  placeholder: string;
  value: string;
  clearable: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
}) {
  useLanguage();
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="list-tools"
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <div className="search-field">
        <button type="submit" className="icon-button" aria-label={t('ui.search_field.search')}>
          <Search size={18} aria-hidden="true" />
        </button>
        <input
          ref={input}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          maxLength={200}
          enterKeyHint="search"
          onChange={(event) => onChange(event.target.value)}
        />
        {clearable && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('ui.search_field.clear_search')}
            onClick={() => {
              onClear();
              input.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
