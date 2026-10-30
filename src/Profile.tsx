import { applicationError, t, intlLocale, useLanguage, setLanguage } from './i18n';
import LanguageSelect from './LanguageSelect';
import { resolveLanguage } from '../shared/locale';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Trash2 } from 'lucide-react';
import { profileSchema, type User } from '../shared/domain';
import { send } from './api';
import ThemeSettings from './ThemeSettings';
export default function Profile({ user, onSave }: { user: User; onSave: (user: User) => void }) {
  useLanguage();
  const [language, chooseLanguage] = useState(resolveLanguage(user.language));
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'bio', string>>>({});
  const changed =
    name !== user.name || bio !== user.bio || language !== resolveLanguage(user.language);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const parsed = profileSchema.safeParse({ name, bio, language });
    if (!parsed.success) {
      const errors: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as 'name' | 'bio';
        errors[field] ??= applicationError(issue.message);
      }
      setFieldErrors(errors);
      document.getElementById(errors.name ? 'profile-name' : 'profile-bio')?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await send<{
        user: User;
      }>('/api/v1/me', parsed.data, 'PATCH');
      setName(result.user.name);
      setBio(result.user.bio);
      chooseLanguage(resolveLanguage(result.user.language));
      setLanguage(resolveLanguage(result.user.language));
      onSave(result.user);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="profile-card" aria-label={t('ui.profile.edit_profile')}>
        <div className="profile-identity">
          <div className="avatar profile-avatar" aria-hidden="true">
            {user.name.slice(0, 1)}
          </div>
          <div>
            <h2>{user.name}</h2>
          </div>
        </div>
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <LanguageSelect
            id="profile-language"
            value={language}
            onChange={chooseLanguage}
            disabled={busy}
            hint
          />
          <label htmlFor="profile-name">
            {t('ui.onboarding.nickname_display_name')}
            <span className="profile-required">{t('ui.onboarding.required')}</span>
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
            {t('ui.profile.your_name_as_displayed_in_the_app_up_to')}
          </p>
          {fieldErrors.name && (
            <p id="profile-name-error" className="profile-field-error" role="alert">
              {fieldErrors.name}
            </p>
          )}
          <label htmlFor="profile-bio">
            {t('ui.profile.bio')}
            <span className="optional">{t('ui.app.optional')}</span>
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setFieldErrors((errors) => ({ ...errors, bio: undefined }));
            }}
            placeholder={t('ui.profile.try_writing_about_your_interests_and_topics_you_want')}
            rows={9}
            maxLength={1000}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.bio)}
            aria-describedby={`profile-bio-hint${fieldErrors.bio ? ' profile-bio-error' : ''}`}
          />
          <p id="profile-bio-hint" className="profile-hint profile-bio-hint">
            <span>{t('ui.profile.up_to_1_000_characters_line_breaks_are_allowed')}</span>
            <span>{bio.length.toLocaleString(intlLocale())} / 1,000</span>
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
                chooseLanguage(resolveLanguage(user.language));
                setName(user.name);
                setBio(user.bio);
                setFieldErrors({});
                setError('');
              }}
            >
              {t('ui.profile.undo_changes')}
            </button>
            <button type="submit" className="button primary" disabled={busy || !changed}>
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Check size={17} aria-hidden="true" />
              )}
              {busy ? t('ui.app.saving') : t('ui.profile.save')}
            </button>
          </div>
        </form>
        <details className="account-deletion">
          <summary>{t('ui.profile.how_do_i_delete_my_account')}</summary>
          <h3>{t('ui.profile.account_deletion')}</h3>
          <p>{t('ui.profile.deleting_your_account_removes_your_profile_and_all_registered')}</p>
          <button
            type="button"
            className="button danger-text"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={17} aria-hidden="true" />
            {t('ui.profile.delete_your_account')}
          </button>
        </details>
      </section>
      <ThemeSettings />
      {confirmDelete && <AccountDeleteDialog onCancel={() => setConfirmDelete(false)} />}
    </>
  );
}
function AccountDeleteDialog({ onCancel }: { onCancel: () => void }) {
  useLanguage();
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
      const result = await send<{
        cleanup_pending: boolean;
      }>('/api/v1/me', {}, 'DELETE');
      // ページを開き直し、メモリ上の本人のデータも破棄する。
      window.location.replace(`/?withdrawn=${result.cleanup_pending ? 'pending' : 'complete'}`);
    } catch (e) {
      setError(applicationError((e as Error).message));
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
        <h2 id={titleId}>{t('ui.profile.delete_your_account_and_all_data')}</h2>
      </div>
      <div id={descriptionId} className="account-deletion-description">
        <p>{t('ui.profile.all_of_the_following_data_will_be_deleted_and')}</p>
        <ul>
          <li>{t('ui.profile.profile_and_projects')}</li>
          <li>{t('ui.profile.saved_articles_entered_text_and_notes')}</li>
          <li>{t('ui.profile.questions_insights_pufu_and_all_phases_and_memory')}</li>
          <li>{t('ui.profile.shortcut_and_mcp_connections_registered_x_tokens_and_usage')}</li>
        </ul>
        <p>{t('ui.profile.you_will_be_signed_out_on_every_device_and')}</p>
        <p>{t('ui.profile.published_projects_will_also_become_unavailable')}</p>
        <p>{t('ui.profile.your_google_account_itself_will_not_be_deleted')}</p>
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
          {t('ui.app.cancel')}
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
          {busy ? t('ui.profile.deleting_account') : t('ui.profile.delete_all_data_and_account')}
        </button>
      </div>
    </dialog>
  );
}
