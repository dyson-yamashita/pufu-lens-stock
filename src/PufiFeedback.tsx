import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, X } from 'lucide-react';
import {
  feedbackCategories,
  type FeedbackInput,
  type FeedbackReceipt,
  type FeedbackQuestion,
  type FeedbackMessage,
  type FeedbackScreen,
} from '../shared/feedback';
import { FeedbackDetector, FeedbackFrequency } from './feedback-detector';
import { api, ApiError, createRequestId, send } from './api';
import { useLanguage, translateUi, legalHref } from './i18n';
import type { Language } from '../shared/locale';
import ManualHelp from './ManualHelp';

export default function PufiFeedback({
  detector,
  host,
  blocked,
  screen = 'pufu-editor',
  alwaysVisible = false,
  language: forcedLanguage,
}: {
  detector: FeedbackDetector;
  host: HTMLElement | null;
  blocked: boolean;
  screen?: FeedbackScreen;
  alwaysVisible?: boolean;
  language?: Language;
}) {
  const current = useLanguage();
  const language = forcedLanguage ?? current.language;
  const t = (key: string, values?: Record<string, string | number>) =>
    translateUi(language, key, values);
  // Move one stable portal root so native dialog changes never reset a conversation.
  const [portal] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    portal.style.display = 'contents';
    (host ?? document.body).appendChild(portal);
    return () => {
      portal.remove();
    };
  }, [host, portal]);
  const [panel, setPanel] = useState<'closed' | 'prompt' | 'conversation'>('closed');
  const [helpEscalated, setHelpEscalated] = useState(false);
  const [manualReading, setManualReading] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
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
    try {
      frequency.current = new FeedbackFrequency(localStorage, sessionStorage);
    } catch {
      /* automatic prompts disabled */
    }
  }, []);
  useEffect(() => {
    if (panel === 'conversation' && !manualReading) heading.current?.focus();
  }, [panel, manualReading]);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    if (blocked || alwaysVisible || panel !== 'closed') return;
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
  }, [blocked, panel, detector, alwaysVisible]);
  function close() {
    if (sending.current || helpBusy) return;
    generation.current++;
    if (panel === 'prompt') frequency.current?.markShown(true);
    setPanel('closed');
    setManualReading(false);
  }
  async function startConversation(manual = false) {
    const version = ++generation.current;
    requestId.current = createRequestId();
    frozen.current = null;
    setCategory(null);
    setHelpEscalated(false);
    setManualReading(false);
    setHelpBusy(false);
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
  async function submit(
    finish = false,
    helpDetail?: Pick<FeedbackInput, 'detail' | 'manual_context'>,
  ) {
    if (!category || !owner || sending.current || invalidSession || done) return;
    if (!finish && followUp && !draft.trim() && !frozen.current) return;
    if (!frozen.current) {
      const text = helpDetail?.detail ?? draft.trim();
      frozen.current = {
        owner_id: owner,
        request_id: requestId.current,
        screen,
        language,
        ...(helpDetail?.manual_context ? { manual_context: helpDetail.manual_context } : {}),
        category,
        detail: followUp ? '' : text,
        reasons,
        consent: true,
        finish,
        round: followUp && (text || !finish) ? round + 1 : round,
        ...(followUp && text ? { answer: text } : {}),
      };
      if (text && !helpDetail) setMessages((current) => [...current, { role: 'user', text }]);
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
  if (panel === 'closed' && !alwaysVisible) return null;
  return createPortal(
    <aside
      className="pufi-feedback"
      style={{ display: blocked ? 'none' : undefined }}
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
          hidden={manualReading}
        >
          <div className="pufi-panel-head">
            <div className="pufi-name">
              <img src="/pufi-feedback.png" alt="" width="36" height="36" />
              <h2 id="pufi-panel-title" ref={heading} tabIndex={-1}>
                {t('feedback.title')}
              </h2>
            </div>
            <div className="pufi-head-actions">
              <button
                className="icon-button"
                aria-label={t('feedback.close')}
                disabled={busy || helpBusy}
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
          {panel === 'conversation' && (
            <>
              {category === 'navigation' && !helpEscalated ? (
                <ManualHelp
                  owner={owner}
                  language={language}
                  initialMessages={messages}
                  onBusy={setHelpBusy}
                  onClose={close}
                  onManualNavigate={() => setManualReading(true)}
                  onInvalidSession={() => {
                    setInvalidSession(true);
                    setError(t('feedback.session_changed'));
                  }}
                  onEscalate={(detail, history) => {
                    setHelpEscalated(true);
                    setMessages(history);
                    void submit(false, detail);
                  }}
                />
              ) : (
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
                </>
              )}
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
                          {
                            role: 'pufi',
                            text: t(
                              value === 'navigation'
                                ? 'feedback.help_question'
                                : 'feedback.ask_detail',
                            ),
                          },
                        ]);
                      }}
                    >
                      {t(`feedback.${value}`)}
                    </button>
                  ))}
                </div>
              )}
              {category && !done && (category !== 'navigation' || helpEscalated) && (
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
                      {t(draft.trim() || !followUp ? 'feedback.finish_send' : 'feedback.finish')}
                    </button>
                  </div>
                </form>
              )}
              {done && (
                <button className="pufi-finish" onClick={close}>
                  {t('feedback.done')}
                </button>
              )}
              <details className="pufi-details">
                <summary>{t('feedback.details')}</summary>
                <p>{t('feedback.explanation')}</p>
                <a href={legalHref('privacy', language)} target="_blank" rel="noreferrer">
                  {t('feedback.privacy_link')}
                </a>
              </details>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      )}
      <div className="pufi-launcher">
        {(panel === 'closed' || manualReading) && (
          <button
            type="button"
            className="pufi-invitation"
            onClick={() => (manualReading ? setManualReading(false) : void startConversation(true))}
          >
            {t(manualReading ? 'feedback.resume' : 'feedback.invitation')}
          </button>
        )}
        <button
          type="button"
          className="pufi-avatar"
          aria-label={t('feedback.open')}
          aria-expanded={panel !== 'closed' && !manualReading}
          disabled={busy || helpBusy}
          onClick={() =>
            manualReading
              ? setManualReading(false)
              : panel === 'closed'
                ? void startConversation(true)
                : close()
          }
        >
          <img src="/pufi-feedback.png" alt="" width="64" height="64" />
        </button>
      </div>
    </aside>,
    portal,
  );
}
