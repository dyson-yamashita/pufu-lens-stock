import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { onboardingSchema, type User } from '../shared/domain';
import { legalVersions } from '../shared/legal';
import { send } from './api';

export default function Onboarding({
  onComplete,
  onLogout,
}: {
  onComplete: (user: User) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = {
    name,
    terms_accepted: terms,
    privacy_accepted: privacy,
    terms_version: legalVersions.terms,
    privacy_version: legalVersions.privacy,
  };
  const valid = onboardingSchema.safeParse(input).success;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = onboardingSchema.safeParse(input);
    if (busy || !parsed.success) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ user: User; redirect_to: string | null }>(
        '/api/v1/onboarding',
        parsed.data,
      );
      if (result.redirect_to) window.location.assign(result.redirect_to);
      else onComplete(result.user);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="onboarding-page">
      <a className="brand" href="/" aria-label="Pufu Lens ホーム">
        <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
        <span>Pufu Lens</span>
      </a>
      <main className="onboarding-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">Pufu Lensへようこそ</h1>
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <label htmlFor="onboarding-name">
            ニックネーム（表示名）<span className="profile-required">必須</span>
          </label>
          <input
            id="onboarding-name"
            autoComplete="nickname"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            required
            maxLength={80}
            disabled={busy}
            aria-describedby="onboarding-name-hint"
          />
          <p id="onboarding-name-hint" className="profile-hint">
            アプリ内で使う名前です。本名である必要はありません。80文字まで。
          </p>
          <fieldset className="onboarding-consents" disabled={busy}>
            <legend>利用条件への同意</legend>
            <div className="onboarding-consent">
              <input
                id="onboarding-terms"
                type="checkbox"
                checked={terms}
                required
                onChange={(event) => setTerms(event.currentTarget.checked)}
              />
              <label htmlFor="onboarding-terms">
                <a href="/terms" target="_blank" rel="noreferrer">
                  利用規約
                </a>
                に同意します
              </label>
            </div>
            <div className="onboarding-consent">
              <input
                id="onboarding-privacy"
                type="checkbox"
                checked={privacy}
                required
                onChange={(event) => setPrivacy(event.currentTarget.checked)}
              />
              <label htmlFor="onboarding-privacy">
                <a href="/privacy" target="_blank" rel="noreferrer">
                  プライバシーポリシー
                </a>
                に同意します
              </label>
            </div>
            <p className="profile-hint">
              リンク先は新しいタブで開きます。両方の内容をご確認ください。
            </p>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary onboarding-submit"
            type="submit"
            disabled={!valid || busy}
          >
            {busy && <LoaderCircle className="spin" size={17} aria-hidden="true" />}OK
          </button>
        </form>
        <button
          className="text-button onboarding-logout"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await send('/api/v1/logout');
              onLogout();
            } catch (caught) {
              setError((caught as Error).message);
              setBusy(false);
            }
          }}
        >
          ログアウト
        </button>
      </main>
    </div>
  );
}
