import { useId, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { PufuScore } from '../shared/pufu';
import { t, useLanguage } from './i18n';
import { parsePufuJson, readPufuJson } from './pufu-import';

export default function PufuJsonImport({
  disabled,
  onBusyChange,
  onImport,
  onError,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onImport: (score: PufuScore, filename: string) => void;
  onError: (message: string) => void;
}) {
  useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const [text, setText] = useState('');
  const textId = useId();
  async function load(read: () => PufuScore | Promise<PufuScore>, filename: string) {
    if (disabled || reading.current) return;
    reading.current = true;
    onBusyChange(true);
    onError('');
    try {
      onImport(await read(), filename);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      reading.current = false;
      onBusyChange(false);
    }
  }
  return (
    <div className="pufu-json-import">
      <button
        type="button"
        className="button secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={17} aria-hidden="true" />
        {t('pufu.import_file')}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label={t('pufu.import_json')}
        hidden
        disabled={disabled}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          // 同じファイルを再選択した場合もchangeを発火させる。
          event.currentTarget.value = '';
          if (file) await load(() => readPufuJson(file), file.name);
        }}
      />
      <label htmlFor={textId}>{t('pufu.import_text')}</label>
      <textarea
        id={textId}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        rows={6}
        disabled={disabled}
        spellCheck={false}
      />
      <button
        type="button"
        className="button secondary"
        disabled={disabled || !text.trim()}
        onClick={() => load(() => parsePufuJson(text), t('pufu.import_text_source'))}
      >
        {t('pufu.import_load_text')}
      </button>
    </div>
  );
}
