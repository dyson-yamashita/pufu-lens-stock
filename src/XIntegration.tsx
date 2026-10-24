import { useEffect, useState } from 'react';
import { api } from './api';
import DeleteAction from './DeleteAction';

type Status = { configured: boolean; available: boolean };
export default function XIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Status>('/api/v1/integrations/x', { signal: controller.signal })
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setError('Xの連携状態を取得できませんでした。');
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="connect-guide" aria-label="X API連携">
      <p>
        X公式APIのBearer
        Tokenを登録すると、投稿URLから本文を取得できます。APIの契約・閲覧権限・利用料金はX側の設定に従います。
      </p>
      <p>
        認証情報はサーバーで暗号化し、X公式APIへの認証にだけ使用します。登録後の値は表示せず、MCPや他のユーザーには提供しません。
      </p>
      <p role="status">
        {status
          ? status.configured
            ? '登録済み（投稿取得時に認証を確認します）'
            : '未登録'
          : '読み込み中…'}
      </p>
      {status && !status.available && <p>管理者による暗号化キーの設定が必要です。</p>}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          try {
            await api('/api/v1/integrations/x', { method: 'PUT', body: JSON.stringify({ token }) });
            setToken('');
            setStatus({ configured: true, available: true });
            setNotice('Xの認証情報を保存しました。');
          } catch {
            setError('保存できませんでした。トークンの形式と外部連携の設定を確認してください。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="x-token">X API Bearer Token</label>
        <input
          id="x-token"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={token}
          minLength={10}
          maxLength={4096}
          required
          disabled={busy || !status?.available}
          onChange={(event) => setToken(event.target.value)}
          placeholder={status?.configured ? '変更する場合だけ入力' : 'Bearer Tokenを入力'}
        />
        <div className="form-actions">
          <button className="button primary" disabled={busy || !status?.available || !token.trim()}>
            {busy ? '処理中…' : status?.configured ? '更新する' : '登録する'}
          </button>
        </div>
      </form>
      {status?.configured && (
        <DeleteAction
          summary="Xの認証情報の削除"
          label="Xの認証情報を削除"
          title="Xの認証情報を削除しますか？"
          disabled={busy}
          onDelete={async () => {
            await api('/api/v1/integrations/x', { method: 'DELETE' });
            setStatus({ ...status, configured: false });
            setToken('');
            setError('');
            setNotice('Xの認証情報を削除しました。');
          }}
        >
          <p>
            登録したX
            APIの認証情報を削除します。新たにXの投稿を取得するには、認証情報の再登録が必要です。
          </p>
          <p>ストック済みの記事は残ります。</p>
        </DeleteAction>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
