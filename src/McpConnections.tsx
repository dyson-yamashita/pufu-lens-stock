import { useEffect, useState } from 'react';
import { Copy, Layers, LoaderCircle, Trash2 } from 'lucide-react';
import { api } from './api';
import { mcpScopes, type McpConnection } from '../shared/mcp';

export default function McpConnections() {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [url, setUrl] = useState(() => `${window.location.origin}/mcp`);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ enabled: boolean; url: string; connections: McpConnection[] }>(
      '/api/v1/mcp/connections',
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        setUrl(data.url);
        setEnabled(data.enabled);
        setConnections(data.connections);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="shortcuts-page">
      <section className="connect-guide">
        <div className="guide-header">
          <span className="connect-symbol">
            <Layers size={23} aria-hidden="true" />
          </span>
          <div>
            <h2>ChatGPTなどからストック・問いを使う</h2>
            <p>会話の中で、保存した情報を活用できます。</p>
          </div>
        </div>
        <p>
          接続先で次のURLを登録して、Pufu
          Lensにログインしてください。連携時に、閲覧・追加の許可とアクセスするプロジェクトを選べます。
        </p>
        <div className="mcp-endpoint-field">
          <label htmlFor="mcp-url">MCPサーバーのURL</label>
          <div className="mcp-endpoint">
            <input id="mcp-url" value={url} readOnly onFocus={(event) => event.target.select()} />
            <button
              className="icon-button"
              aria-label="MCPサーバーのURLをコピー"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setNotice('URLをコピーしました。');
                } catch {
                  setError('URLを選択してコピーしてください。');
                }
              }}
            >
              <Copy size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {enabled === false && (
          <p role="status">
            現在、MCP連携は未設定です。管理者による接続設定が完了すると、このURLから連携できます。
          </p>
        )}
        <p>
          接続先から「プロジェクトのストックを探して」「この問いを保存して」と依頼できます。ストックを追加すると、要約とAIの問いが順次生成されます。
        </p>
      </section>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="token-section">
        <div className="section-head">
          <h2>接続中のサービス</h2>
        </div>
        {loading ? (
          <p>
            <LoaderCircle className="spin" size={17} aria-hidden="true" /> 読み込み中…
          </p>
        ) : enabled === null ? (
          <p className="token-empty">接続中のサービスを取得できませんでした。</p>
        ) : enabled === false ? (
          <p className="token-empty">MCP連携の設定完了後、接続したサービスがここに表示されます。</p>
        ) : !connections.length ? (
          <p className="token-empty">連携はまだありません。接続先で上のURLを登録してください。</p>
        ) : (
          <ul className="token-list mcp-connections">
            {connections.map((connection) => (
              <li className="token-row" key={connection.id}>
                <Layers size={19} aria-hidden="true" />
                <div>
                  <strong>{connection.client_name}</strong>
                  <p>{connection.project_name ?? 'すべてのプロジェクト'}</p>
                  <p>
                    {connection.scopes
                      .map((scope) => mcpScopes[scope as keyof typeof mcpScopes] ?? scope)
                      .join('・')}
                  </p>
                  <small>
                    接続日: {new Date(connection.created_at).toLocaleDateString('ja-JP')}
                    {connection.expires_at &&
                      ` ／ 有効期限: ${new Date(connection.expires_at).toLocaleDateString('ja-JP')}`}
                  </small>
                </div>
                <button
                  className="button danger"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (!window.confirm(`${connection.client_name}との連携を解除しますか？`))
                      return;
                    setBusy(connection.id);
                    setError('');
                    try {
                      await api(`/api/v1/mcp/connections/${encodeURIComponent(connection.id)}`, {
                        method: 'DELETE',
                      });
                      setConnections((items) => items.filter((item) => item.id !== connection.id));
                      setNotice('連携を解除しました。');
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {busy === connection.id ? '解除中…' : '連携を解除'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
