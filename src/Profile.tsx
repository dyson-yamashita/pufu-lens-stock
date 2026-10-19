import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Trash2 } from 'lucide-react';
import { profileSchema, type User } from '../shared/domain';
import { send } from './api';
import ThemeSettings from './ThemeSettings';

export default function Profile({ user, onSave }: { user: User; onSave: (user: User) => void }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'bio', string>>>({});
  const changed = name !== user.name || bio !== user.bio;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const parsed = profileSchema.safeParse({ name, bio });
    if (!parsed.success) {
      const errors: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as 'name' | 'bio';
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      document.getElementById(errors.name ? 'profile-name' : 'profile-bio')?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await send<{ user: User }>('/api/v1/me', parsed.data, 'PATCH');
      setName(result.user.name);
      setBio(result.user.bio);
      onSave(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="profile-card" aria-label="プロフィールの編集">
        <div className="profile-identity">
          <div className="avatar profile-avatar" aria-hidden="true">
            {user.name.slice(0, 1)}
          </div>
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <label htmlFor="profile-name">
            名前<span className="profile-required">必須</span>
          </label>
          <input
            id="profile-name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((errors) => ({ ...errors, name: undefined }));
            }}
            required
            maxLength={80}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={`profile-name-hint${fieldErrors.name ? ' profile-name-error' : ''}`}
          />
          <p id="profile-name-hint" className="profile-hint">
            アプリ内で表示される名前です。80文字まで。
          </p>
          {fieldErrors.name && (
            <p id="profile-name-error" className="profile-field-error" role="alert">
              {fieldErrors.name}
            </p>
          )}
          <label htmlFor="profile-bio">
            自己紹介<span className="optional">任意</span>
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setFieldErrors((errors) => ({ ...errors, bio: undefined }));
            }}
            placeholder={`以下について書いてみましょう。

・関心のあること、取り組みたいテーマ
・役割や経験、得意分野
・大切にしている考え方や進め方
・普段関わる人やコミュニティ
・仕事や活動の環境、使い慣れた技術や道具`}
            rows={9}
            maxLength={1000}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.bio)}
            aria-describedby={`profile-bio-hint${fieldErrors.bio ? ' profile-bio-error' : ''}`}
          />
          <p id="profile-bio-hint" className="profile-hint profile-bio-hint">
            <span>1,000文字まで。改行も使えます。</span>
            <span>{bio.length.toLocaleString('ja-JP')} / 1,000</span>
          </p>
          {fieldErrors.bio && (
            <p id="profile-bio-error" className="profile-field-error" role="alert">
              {fieldErrors.bio}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !changed}
              onClick={() => {
                setName(user.name);
                setBio(user.bio);
                setFieldErrors({});
                setError('');
              }}
            >
              変更を戻す
            </button>
            <button className="button primary" disabled={busy || !changed}>
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Check size={17} aria-hidden="true" />
              )}
              {busy ? '保存中…' : '保存する'}
            </button>
          </div>
        </form>
        <section className="account-deletion" aria-labelledby="account-deletion-title">
          <h3 id="account-deletion-title">退会</h3>
          <p>
            退会すると、プロフィールと登録したすべてのデータが削除されます。削除したデータは復元できません。
          </p>
          <button
            type="button"
            className="button danger-text"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={17} aria-hidden="true" />
            退会する
          </button>
        </section>
      </section>
      <ThemeSettings />
      {confirmDelete && <AccountDeleteDialog onCancel={() => setConfirmDelete(false)} />}
    </>
  );
}

function AccountDeleteDialog({ onCancel }: { onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => dialog.close();
  }, []);
  const cancel = () => {
    if (busy) return;
    dialogRef.current?.close();
    onCancel();
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ cleanup_pending: boolean }>('/api/v1/me', {}, 'DELETE');
      // ページを開き直し、メモリ上の本人のデータも破棄する。
      window.location.replace(`/?withdrawn=${result.cleanup_pending ? 'pending' : 'complete'}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>退会してすべてのデータを削除しますか？</h2>
      </div>
      <div id={descriptionId} className="account-deletion-description">
        <p>以下のデータがすべて削除され、復元できなくなります。</p>
        <ul>
          <li>プロフィール、プロジェクト</li>
          <li>ストックした記事・入力した本文・メモ</li>
          <li>問い、プ譜とすべての局面、メモリ</li>
          <li>ショートカット・MCPの連携、登録したXのトークン、利用履歴</li>
        </ul>
        <p>すべての端末でログアウトし、連携トークンも使えなくなります。</p>
        <p>公開中のプロジェクトも閲覧できなくなります。</p>
        <p>Googleアカウント自体は削除されません。</p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          ref={cancelRef}
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={cancel}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="button danger-text"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          ) : (
            <Trash2 size={17} aria-hidden="true" />
          )}
          {busy ? '退会処理中…' : 'すべて削除して退会する'}
        </button>
      </div>
    </dialog>
  );
}
