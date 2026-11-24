import { Copy, Share2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Publication } from '../../../shared/public-project';
import { publicHref } from '../../../shared/public-route';
import { Spinner } from '../../components/Spinner';
import { t, useLanguage } from '../../i18n/i18n';
import { useResource } from './useResource';

type ShareTarget =
  | { kind: 'project' }
  | { kind: 'stock' | 'question'; id: string }
  | { kind: 'pufu'; id: string; phase: number };

type ShareButtonProps = {
  target: ShareTarget;
  visibility?: { open: boolean; onChange: (open: boolean) => void };
};

type ShareLinkProps = ShareButtonProps & {
  source: { publicId: string } | { projectId: string };
};

function sharePath(publicId: string, target: ShareTarget) {
  const base = `/p/${encodeURIComponent(publicId)}`;
  if (target.kind === 'project') return base;
  const detail = publicHref(base, `#${target.kind}/${encodeURIComponent(target.id)}`);
  return target.kind === 'pufu' ? `${detail}?phase=${target.phase}` : detail;
}

export function ShareLink({ source, ...buttonProps }: ShareLinkProps) {
  return 'projectId' in source ? (
    <OwnerShareLink {...buttonProps} projectId={source.projectId} />
  ) : (
    <ShareButton {...buttonProps} publicId={source.publicId} />
  );
}

function OwnerShareLink({ projectId, ...buttonProps }: ShareButtonProps & { projectId: string }) {
  const { data, reload } = useResource<{ publication: Publication }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/publication?include_view_stats=false`,
  );
  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') reload();
    }
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [reload]);
  const publication = data?.publication;
  if (!publication?.is_public || !publication.public_id) return null;
  return <ShareButton {...buttonProps} publicId={publication.public_id} verify />;
}

function ShareButton({
  target,
  publicId,
  visibility,
  verify = false,
}: ShareButtonProps & { publicId: string; verify?: boolean }) {
  useLanguage();
  const [localOpen, setLocalOpen] = useState(false);
  const open = visibility?.open ?? localOpen;
  const setOpen = visibility?.onChange ?? setLocalOpen;
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const path = sharePath(publicId, target);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!open || !next || event.currentTarget.contains(next)) return;
        if (target.kind === 'pufu' && next.closest('[data-share-phase-navigation]')) return;
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className="share-link"
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Share2 size={16} aria-hidden="true" />
        <span>{t('share.open')}</span>
      </button>
      {open && (
        <section className="share-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
          <div className="share-panel-heading">
            <h2 id={`${panelId}-title`}>
              {target.kind === 'pufu'
                ? t('share.pufu', { number: target.phase })
                : t(`share.${target.kind}`)}
            </h2>
            <button
              type="button"
              className="icon-button"
              onClick={close}
              aria-label={t('share.close')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {verify ? <VerifiedShareDetails path={path} /> : <ShareActions key={path} path={path} />}
        </section>
      )}
    </div>
  );
}

function VerifiedShareDetails({ path }: { path: string }) {
  const { data, error, reload } = useResource<unknown>(
    path.replace(/^\/p\//, '/api/public/projects/'),
  );
  return data ? (
    <ShareActions key={path} path={path} />
  ) : (
    <ShareLoading error={error} retry={reload} />
  );
}

function ShareLoading({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <>
      <p role="alert">{error}</p>
      <button type="button" className="button secondary" onClick={retry}>
        {t('ui.app.reload')}
      </button>
    </>
  ) : (
    <p role="status" className="share-loading">
      <Spinner />
      {t('ui.public_projects.loading')}
    </p>
  );
}

function ShareActions({ path }: { path: string }) {
  const url = new URL(path, window.location.origin).href;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<'copied' | 'manual_copy' | 'native_failed'>();
  const canShare = typeof navigator.share === 'function' && (navigator.canShare?.({ url }) ?? true);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('copied');
    } catch {
      input.current?.focus();
      input.current?.select();
      setNotice('manual_copy');
    }
  }

  async function share() {
    setNotice(undefined);
    try {
      await navigator.share({ url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setNotice('native_failed');
    }
  }

  return (
    <>
      <p>{t('share.public')}</p>
      <label htmlFor={id}>{t('share.url')}</label>
      <div className="share-url-row">
        <input id={id} ref={input} type="url" readOnly value={url} />
        <button type="button" className="icon-button" aria-label={t('share.copy')} onClick={copy}>
          <Copy size={18} aria-hidden="true" />
          {t('ui.public_projects.copy')}
        </button>
      </div>
      {canShare && (
        <button type="button" className="button secondary share-native" onClick={share}>
          <Share2 size={16} aria-hidden="true" />
          {t('share.native')}
        </button>
      )}
      <p className="share-status" role="status">
        {notice && t(`share.${notice}`)}
      </p>
    </>
  );
}
