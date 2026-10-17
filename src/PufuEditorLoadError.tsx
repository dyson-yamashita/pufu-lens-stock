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
      <h2>エディターを読み込めませんでした</h2>
      <p>作成したプ譜は保存されています。画面を再読み込みして、もう一度お試しください。</p>
      <button className="button secondary" onClick={() => window.location.reload()}>
        <RefreshCw size={17} aria-hidden="true" />
        画面を再読み込み
      </button>
    </div>
  );
}
