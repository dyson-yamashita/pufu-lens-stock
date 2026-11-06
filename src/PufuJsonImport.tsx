import { useRef } from 'react';
import { Upload } from 'lucide-react';
import type { PufuScore } from '../shared/pufu';
import { t, useLanguage } from './i18n';
import { readPufuJson } from './pufu-import';

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
  return (
    <>
      <button
        type="button"
        className="button secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={17} aria-hidden="true" />
        {t('pufu.import_json')}
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
          if (!file || disabled || reading.current) return;
          reading.current = true;
          onBusyChange(true);
          onError('');
          try {
            onImport(await readPufuJson(file), file.name);
          } catch (error) {
            onError((error as Error).message);
          } finally {
            reading.current = false;
            onBusyChange(false);
          }
        }}
      />
    </>
  );
}
