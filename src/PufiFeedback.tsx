import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Settings, X } from 'lucide-react';
import {
  feedbackCategories,
  type FeedbackInput,
  type FeedbackReceipt,
  type FeedbackQuestion,
  type FeedbackMessage,
} from '../shared/feedback';
import { FeedbackDetector, FeedbackFrequency } from './feedback-detector';
import { api, ApiError, createRequestId, send } from './api';
import { t, useLanguage, legalHref } from './i18n';

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
  const [panel, setPanel] = useState<'closed' | 'settings' | 'prompt' | 'conversation'>('closed');
  const [reasons, setReasons] = useState<FeedbackInput['reasons']>([]);
  const [category, setCategory] = useState<FeedbackInput['category'] | null>(null);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const [followUp, setFollowUp] = useState<FeedbackQuestion | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState('');
  const [invalidSession, setInvalidSession] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef('');
  const frozen = useRef<FeedbackInput | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const frequency = useRef<FeedbackFrequency | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
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
      /* automatic prompts disabled */
    }
  }, []);
  useEffect(() => {
    if (panel === 'conversation' || panel === 'settings') heading.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    if (!consent || blocked || panel !== 'closed') return;
    let lastInput = Date.now();
    const input = () => {
      lastInput = Date.now();
    };
    document.addEventListener('input', input);
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === 'hidden' ||
        !navigator.onLine ||
        Date.now() - lastInput < 3000 ||
        document.activeElement?.matches('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector('[aria-busy="true"], .onboarding-page')
      )
        return;
      const result = detector.evaluate();
      if (result.total < 3 || !frequency.current?.canShow()) return;
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
    if (sending.current) return;
    generation.current++;
    if (panel === 'prompt') frequency.current?.markShown(true);
    setPanel('closed');
  }
  async function startConversation(manual = false) {
    const version = ++generation.current;
    requestId.current = createRequestId();
    frozen.current = null;
    setCategory(null);
    setDraft('');
    setRound(0);
    setFollowUp(null);
    setDone(false);
    setMessages([]);
    setError('');
    setInvalidSession(false);
    setOwner('');
    setPanel('conversation');
    if (manual) setReasons([]);
    try {
      const result = await api<{ user: { id: string } }>('/api/v1/me');
      if (generation.current === version) setOwner(result.user.id);
    } catch {
      if (generation.current === version) setError(t('feedback.failed'));
    }
  }
  async function submit(finish = false) {
    if (!category || !owner || sending.current || invalidSession || done) return;
    if (!finish && followUp && !draft.trim() && !frozen.current) return;
    if (!frozen.current) {
      const text = draft.trim();
      frozen.current = {
        owner_id: owner,
        request_id: requestId.current,
        screen: 'pufu-editor',
        category,
        detail: followUp ? '' : text,
        reasons,
        consent: true,
        finish,
        round: followUp && (text || !finish) ? round + 1 : round,
        ...(followUp && text ? { answer: text } : {}),
      };
      if (text) setMessages((current) => [...current, { role: 'user', text }]);
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await send<FeedbackReceipt>('/api/v1/feedback', frozen.current);
      if (result.pending) {
        setError(t('feedback.wait_retry'));
        return;
      }
      frozen.current = null;
      setDraft('');
      setRound(result.round);
      if (result.follow_up) {
        setFollowUp(result.follow_up);
        setMessages((current) => [
          ...current,
          { role: 'pufi', text: t(`feedback.question_${result.follow_up}`) },
        ]);
      } else {
        setDone(true);
        setMessages((current) => [...current, { role: 'pufi', text: t('feedback.thanks') }]);
      }
    } catch (error) {
      const changed = error instanceof ApiError && [401, 409, 410].includes(error.status);
      if (changed) {
        setInvalidSession(true);
        frozen.current = null;
      }
      setError(t(changed ? 'feedback.session_changed' : 'feedback.failed'));
    } finally {
      sending.current = false;
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
        <section
          className={`pufi-panel${panel === 'prompt' ? ' pufi-prompt' : ''}`}
          aria-labelledby="pufi-panel-title"
        >
          <div className="pufi-panel-head">
            <div className="pufi-name">
              <img src="/pufi-feedback.png" alt="" width="36" height="36" />
              <h2 id="pufi-panel-title" ref={heading} tabIndex={-1}>
                {t('feedback.title')}
              </h2>
            </div>
            <div className="pufi-head-actions">
              {panel !== 'prompt' && (
                <button
                  className="icon-button"
                  aria-label={t('feedback.settings')}
                  disabled={busy}
                  onClick={() =>
                    setPanel((current) => (current === 'settings' ? 'conversation' : 'settings'))
                  }
                >
                  <Settings size={17} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label={t('feedback.close')}
                disabled={busy}
                onClick={close}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          {panel === 'prompt' && (
            <>
              <p className="pufi-greeting" role="status">
                {t('feedback.prompt')}
              </p>
              <div className="pufi-actions">
                <button className="button primary" onClick={() => startConversation()}>
                  {t('feedback.yes')}
                </button>
                <button className="button secondary" onClick={close}>
                  {t('feedback.fine')}
                </button>
              </div>
            </>
          )}
          {panel === 'settings' && (
            <>
              <p className="pufi-greeting">{t('feedback.setting_question')}</p>
              <label className="pufi-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => changeConsent(e.currentTarget.checked)}
                />
                {t('feedback.enable')}
              </label>
              <details className="pufi-details">
                <summary>{t('feedback.details')}</summary>
                <p>{t('feedback.explanation')}</p>
                <a href={legalHref('privacy')} target="_blank" rel="noreferrer">
                  {t('feedback.privacy_link')}
                </a>
              </details>
              <button className="button secondary" onClick={() => setPanel('conversation')}>
                {t('feedback.back')}
              </button>
            </>
          )}
          {panel === 'conversation' && (
            <>
              <div
                className="pufi-thread"
                ref={thread}
                role="log"
                aria-label={t('feedback.conversation')}
                aria-live="polite"
              >
                <p className="pufi-message pufi-message-pufi">{t('feedback.hello')}</p>
                {messages.map((message, index) => (
                  <p key={index} className={`pufi-message pufi-message-${message.role}`}>
                    {message.text}
                  </p>
                ))}
                {busy && (
                  <p className="pufi-message pufi-message-pufi">{t('feedback.listening')}</p>
                )}
              </div>
              {!category && (
                <div className="pufi-choices">
                  {feedbackCategories.map((value) => (
                    <button
                      key={value}
                      className="pufi-chip"
                      disabled={!owner}
                      onClick={() => {
                        setCategory(value);
                        setMessages([
                          { role: 'user', text: t(`feedback.${value}`) },
                          { role: 'pufi', text: t('feedback.ask_detail') },
                        ]);
                      }}
                    >
                      {t(`feedback.${value}`)}
                    </button>
                  ))}
                </div>
              )}
              {category && !done && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <div className="pufi-compose">
                    <textarea
                      aria-label={t('feedback.reply')}
                      placeholder={t('feedback.reply_hint')}
                      rows={2}
                      maxLength={1000}
                      value={draft}
                      disabled={busy || !!frozen.current || invalidSession}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                    />
                    <button
                      className="pufi-send"
                      aria-label={t('feedback.send')}
                      disabled={
                        busy || invalidSession || (!draft.trim() && !!followUp && !frozen.current)
                      }
                    >
                      <ArrowUp size={20} />
                    </button>
                  </div>
                  <div className="pufi-footer">
                    <span>{t('feedback.consent_hint')}</span>
                    <button
                      type="button"
                      className="pufi-finish"
                      disabled={busy || invalidSession || !!frozen.current}
                      onClick={() => submit(true)}
                    >
                      {t('feedback.finish')}
                    </button>
                  </div>
                </form>
              )}
              {done && (
                <button className="pufi-finish" onClick={close}>
                  {t('feedback.done')}
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      )}
      <button
        type="button"
        className="pufi-avatar"
        aria-label={t('feedback.open')}
        aria-expanded={panel !== 'closed'}
        disabled={busy}
        onClick={() => (panel === 'closed' ? void startConversation(true) : close())}
      >
        <img src="/pufi-feedback.png" alt="" width="64" height="64" />
      </button>
    </aside>,
    host ?? document.body,
  );
}
