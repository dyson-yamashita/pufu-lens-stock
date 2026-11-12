import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { feedbackCategories, type FeedbackInput } from '../shared/feedback';
import { FeedbackDetector, FeedbackFrequency } from './feedback-detector';
import { createRequestId, send } from './api';
import { t, useLanguage } from './i18n';

export default function PufiFeedback({
  detector,
  host,
  blocked,
}: {
  detector: FeedbackDetector;
  host: HTMLElement | null;
  blocked: boolean;
}) {
  useLanguage();
  const [consent, setConsent] = useState(() => {
    try {
      return localStorage.getItem('pufi-detection-consent') === 'true';
    } catch {
      return false;
    }
  });
  const [panel, setPanel] = useState<'closed' | 'settings' | 'prompt' | 'survey' | 'thanks'>(
    'closed',
  );
  const [reasons, setReasons] = useState<FeedbackInput['reasons']>([]);
  const [category, setCategory] = useState<FeedbackInput['category']>('unresponsive');
  const [detail, setDetail] = useState('');
  const [publishConsent, setPublishConsent] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const frozenInput = useRef<FeedbackInput | null>(null);
  const frequency = useRef<FeedbackFrequency | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'pufi-detection-consent' || event.key === null) {
        const enabled = event.key !== null && event.newValue === 'true';
        setConsent(enabled);
        if (!enabled) setPanel((current) => (current === 'prompt' ? 'closed' : current));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    detector.enable(consent);
    return () => detector.enable(false);
  }, [consent, detector]);
  useEffect(() => {
    try {
      frequency.current = new FeedbackFrequency(localStorage, sessionStorage);
    } catch {
      /* auto prompts disabled */
    }
  }, []);
  useEffect(() => {
    if (panel !== 'closed' && panel !== 'prompt') heading.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!consent || blocked || panel !== 'closed') return;
    let lastInput = Date.now();
    const input = () => {
      lastInput = Date.now();
    };
    document.addEventListener('input', input);
    const timer = window.setInterval(() => {
      const active = document.activeElement;
      if (
        document.visibilityState === 'hidden' ||
        !navigator.onLine ||
        Date.now() - lastInput < 3000 ||
        active?.matches('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector('[aria-busy="true"], .onboarding-page')
      )
        return;
      const result = detector.evaluate();
      if (result.total < 3 || !frequency.current?.canShow()) return;
      // Other tabs can update localStorage between timer ticks; check on every display.
      frequency.current.markShown();
      setReasons(result.reasons);
      setPanel('prompt');
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('input', input);
    };
  }, [consent, blocked, panel, detector]);
  function changeConsent(value: boolean) {
    setConsent(value);
    try {
      localStorage.setItem('pufi-detection-consent', String(value));
    } catch {
      /* in-memory only */
    }
  }
  function close() {
    if (busy) return;
    if (panel === 'prompt') frequency.current?.markShown(true);
    setPanel('closed');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!publishConsent || busy) return;
    requestId.current ??= createRequestId();
    // A lost response is retried with exactly the same ID and payload.
    frozenInput.current ??= {
      round,
      ...(round ? { answer } : {}),
      request_id: requestId.current,
      screen: 'pufu-editor',
      category,
      detail,
      reasons,
      consent: true,
    };
    setBusy(true);
    setError('');
    try {
      const result = await send<{ round: number; follow_up: string | null }>(
        '/api/v1/feedback',
        frozenInput.current,
      );
      if (result.follow_up) {
        setFollowUp(result.follow_up);
        setRound(result.round + 1);
        setAnswer('');
        frozenInput.current = null;
      } else {
        setPanel('thanks');
        setDetail('');
      }
    } catch {
      setError(t('feedback.failed'));
    } finally {
      setBusy(false);
    }
  }
  if (blocked) return null;
  return createPortal(
    <aside
      className="pufi-feedback"
      aria-label={t('feedback.title')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panel !== 'closed') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      {panel !== 'closed' && (
        <section className="pufi-panel" aria-labelledby="pufi-panel-title">
          <div className="pufi-panel-head">
            <h2 id="pufi-panel-title" ref={heading} tabIndex={-1}>
              {t('feedback.title')}
            </h2>
            <button
              className="icon-button"
              aria-label={t('feedback.close')}
              disabled={busy}
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          {panel === 'prompt' && (
            <>
              <p>{t('feedback.prompt')}</p>
              <div className="pufi-actions">
                <button className="button primary" onClick={() => setPanel('survey')}>
                  {t('feedback.tell')}
                </button>
                <button className="button secondary" onClick={close}>
                  {t('feedback.fine')}
                </button>
              </div>
            </>
          )}
          {panel === 'settings' && (
            <>
              <p className="field-hint">{t('feedback.explanation')}</p>
              <label className="pufi-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => changeConsent(e.currentTarget.checked)}
                />
                {t('feedback.enable')}
              </label>
              <button
                className="button primary"
                onClick={() => {
                  setReasons([]);
                  setPanel('survey');
                }}
              >
                {t('feedback.tell')}
              </button>
            </>
          )}
          {panel === 'survey' && (
            <form onSubmit={submit}>
              {followUp ? (
                <>
                  <p role="status">{followUp}</p>
                  <label htmlFor="pufi-answer">{t('feedback.answer')}</label>
                  <textarea
                    id="pufi-answer"
                    rows={3}
                    maxLength={1000}
                    required
                    value={answer}
                    disabled={busy || !!frozenInput.current}
                    onChange={(e) => setAnswer(e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setPanel('thanks')}
                  >
                    {t('feedback.finish')}
                  </button>
                </>
              ) : (
                <>
                  <label htmlFor="pufi-category">{t('feedback.category')}</label>
                  <select
                    id="pufi-category"
                    value={category}
                    disabled={busy || !!frozenInput.current}
                    onChange={(e) =>
                      setCategory(e.currentTarget.value as FeedbackInput['category'])
                    }
                  >
                    {feedbackCategories.map((value) => (
                      <option key={value} value={value}>
                        {t(`feedback.${value}`)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="pufi-detail">{t('feedback.detail')}</label>
                  <textarea
                    id="pufi-detail"
                    maxLength={1000}
                    rows={3}
                    value={detail}
                    disabled={busy || !!frozenInput.current}
                    onChange={(e) => setDetail(e.currentTarget.value)}
                  />
                </>
              )}
              <p className="field-hint">{t('feedback.privacy')}</p>
              <label className="pufi-check">
                <input
                  type="checkbox"
                  checked={publishConsent}
                  required
                  disabled={busy}
                  onChange={(e) => setPublishConsent(e.currentTarget.checked)}
                />
                {t('feedback.publish_consent')}
              </label>
              <button className="button primary" disabled={busy || !publishConsent}>
                {t(busy ? 'feedback.sending' : 'feedback.send')}
              </button>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </form>
          )}
          {panel === 'thanks' && <p role="status">{t('feedback.thanks')}</p>}
        </section>
      )}
      <button
        type="button"
        className="pufi-avatar"
        aria-label={t('feedback.open')}
        aria-expanded={panel !== 'closed'}
        disabled={busy}
        onClick={() => {
          if (panel === 'closed') {
            requestId.current = null;
            frozenInput.current = null;
            setDetail('');
            setError('');
            setPublishConsent(false);
            setFollowUp(null);
            setRound(0);
            setAnswer('');
            setPanel('settings');
          } else close();
        }}
      >
        <img src="/pufi-feedback.png" alt="" width="64" height="64" />
      </button>
    </aside>,
    host ?? document.body,
  );
}
