import { t, useLanguage } from './i18n';
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
const reloadKey = 'pufu-editor-load-retry';
export function clearPufuEditorLoadRetry() {
  try {
    window.sessionStorage.removeItem(reloadKey);
  } catch {
    // ストレージを使えない環境でもエディターの表示を妨げない。
  }
}
export default function PufuEditorLoadError() {
  useLanguage();
  useEffect(() => {
    if (navigator.onLine === false) return;
    try {
      const href = window.location.href;
      if (window.sessionStorage.getItem(reloadKey) === href) return;
      // 古いアプリが参照するファイルを取得し直す。再失敗しても再読込を繰り返さない。
      window.sessionStorage.setItem(reloadKey, href);
      window.location.reload();
    } catch {
      // 自動復帰できない場合は、画面内の再読み込みボタンを使えるようにする。
    }
  }, []);
  return (
    <div className="empty-state" role="alert">
      <h2>{t('ui.pufu_editor_load_error.could_not_load_the_editor')}</h2>
      <p>{t('ui.pufu_editor_load_error.your_pufu_is_saved_reload_the_page_and_try')}</p>
      <button className="button secondary" onClick={() => window.location.reload()}>
        <RefreshCw size={17} aria-hidden="true" />
        {t('ui.pufu_editor_load_error.reload_page')}
      </button>
    </div>
  );
}
