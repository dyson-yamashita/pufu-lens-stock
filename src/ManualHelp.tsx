import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { FeedbackMessage, FeedbackInput } from '../shared/feedback';
import type { Language } from '../shared/locale';
import { translateUi } from './i18n';
import { ApiError } from './api';
import { manualTree, selectManualBranch, type ManualNode } from './manual-search';

type HelpMessage = FeedbackMessage & { truncated?: boolean };

export default function ManualHelp({
  owner,
  language,
  initialMessages,
  onBusy,
  onClose,
  onEscalate,
  onInvalidSession,
}: {
  owner: string;
  language: Language;
  initialMessages: FeedbackMessage[];
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onEscalate: (
    detail: Pick<FeedbackInput, 'detail' | 'manual_context'>,
    history: FeedbackMessage[],
  ) => void;
  onInvalidSession: () => void;
}) {
  const t = (key: string) => translateUi(language, key);
  const [messages, setMessages] = useState<HelpMessage[]>(initialMessages);
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const answerId = useId();
  const [draft, setDraft] = useState('');
  const [stage, setStage] = useState<
    'question' | 'choose' | 'answer' | 'hearing' | 'done' | 'invalid'
  >('question');
  const [choices, setChoices] = useState<ManualNode[]>([]);
  const [answer, setAnswer] = useState<ManualNode | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, busy]);
  const query = useRef('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const working = (value: boolean) => {
    setBusy(value);
    onBusy(value);
  };
  const showAnswer = (node: ManualNode) => {
    setAnswer(node);
    setAnswerExpanded(false);
    setChoices([]);
    setStage('answer');
    const excerpt = Array.from(
      new Intl.Segmenter(language, { granularity: 'sentence' }).segment(node.text),
      (part) => part.segment,
    )
      .slice(0, 2)
      .join('')
      .trim()
      .slice(0, 180);
    setMessages((current) => [
      ...current,
      {
        role: 'pufi',
        text: excerpt.length < node.text.length ? `${excerpt}…` : excerpt,
        truncated: excerpt.length < node.text.length,
      },
      { role: 'pufi', text: t('feedback.help_confirm') },
    ]);
  };
  const descend = async (nodes: ManualNode[], chosen?: ManualNode) => {
    working(true);
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    try {
      let candidates = nodes;
      if (chosen) {
        if (chosen.text && !chosen.children.length) {
          showAnswer(chosen);
          return;
        }
        candidates = chosen.children;
      }
      for (let depth = 0; depth < 5 && candidates.length; depth++) {
        if (candidates.length === 1) {
          const only = candidates[0];
          if (only.text && !only.children.length) {
            showAnswer(only);
            return;
          }
          candidates = only.children;
          continue;
        }
        const selected = await selectManualBranch(
          owner,
          query.current,
          candidates,
          language,
          active.signal,
        );
        if (active.signal.aborted) return;
        if (!selected) {
          setChoices(candidates);
          setStage('choose');
          setMessages((current) => [...current, { role: 'pufi', text: t('feedback.help_choose') }]);
          return;
        }
        if (selected.text && !selected.children.length) {
          showAnswer(selected);
          return;
        }
        candidates = selected.children;
      }
      setChoices(candidates);
      setStage('choose');
      setMessages((current) => [...current, { role: 'pufi', text: t('feedback.help_choose') }]);
    } catch (error) {
      if (active.signal.aborted) return;
      if (error instanceof ApiError && [401, 409, 410].includes(error.status)) {
        onInvalidSession();
        setStage('invalid');
      } else {
        setChoices(nodes);
        setStage('choose');
        setMessages((current) => [...current, { role: 'pufi', text: t('feedback.help_choose') }]);
      }
    } finally {
      if (!active.signal.aborted) working(false);
    }
  };
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const history: HelpMessage[] = [...messages, { role: 'user' as const, text }];
    setMessages(history);
    setDraft('');
    if (stage === 'hearing') {
      onEscalate(
        {
          detail: text,
          manual_context: {
            question: query.current,
            topic: answer?.title ?? '',
            section: answer!.id,
          },
        },
        history.map(({ role, text, truncated }) => ({
          role,
          text: truncated && answer ? answer.text : text,
        })),
      );
      return;
    }
    query.current = text;
    working(true);
    try {
      const tree = await manualTree(language);
      if (alive.current) await descend(tree);
    } catch {
      working(false);
      setMessages((current) => [...current, { role: 'pufi', text: t('feedback.failed') }]);
    }
  };
  return (
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
            {message.truncated && answer ? (
              <>
                <span id={answerId}>{answerExpanded ? answer.text : message.text}</span>
                <button
                  type="button"
                  className="pufi-expand"
                  aria-expanded={answerExpanded}
                  aria-controls={answerId}
                  onClick={() => setAnswerExpanded((value) => !value)}
                >
                  {t(answerExpanded ? 'feedback.help_show_less' : 'feedback.help_show_all')}
                </button>
              </>
            ) : (
              message.text
            )}
          </p>
        ))}
        {answer && (
          <a className="pufi-manual-link" href={answer.href} target="_blank" rel="noreferrer">
            {t('feedback.help_open_manual')}
          </a>
        )}
        {busy && <p className="pufi-message pufi-message-pufi">{t('feedback.listening')}</p>}
      </div>
      {stage === 'choose' && !busy && (
        <div className="pufi-choices">
          {choices.map((node) => (
            <button key={node.id} className="pufi-chip" onClick={() => void descend(choices, node)}>
              {node.title}
            </button>
          ))}
        </div>
      )}
      {stage === 'answer' && (
        <div className="pufi-choices">
          <button
            className="pufi-chip"
            onClick={() => {
              setStage('done');
              setMessages((current) => [
                ...current,
                { role: 'user', text: t('feedback.help_solved') },
                { role: 'pufi', text: t('feedback.help_glad') },
              ]);
            }}
          >
            {t('feedback.help_solved')}
          </button>
          <button
            className="pufi-chip"
            onClick={() => {
              setStage('hearing');
              setMessages((current) => [
                ...current,
                { role: 'user', text: t('feedback.help_not_solved') },
                { role: 'pufi', text: t('feedback.help_hearing') },
              ]);
            }}
          >
            {t('feedback.help_not_solved')}
          </button>
        </div>
      )}
      {(stage === 'question' || stage === 'hearing') && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="pufi-compose">
            <textarea
              aria-label={t('feedback.reply')}
              rows={2}
              maxLength={1000}
              value={draft}
              disabled={busy}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <button
              className="pufi-send"
              aria-label={t(stage === 'hearing' ? 'feedback.send' : 'feedback.help_search')}
              disabled={busy || !draft.trim()}
            >
              <ArrowUp size={20} />
            </button>
          </div>
          <div className="pufi-footer">
            <span>
              {t(stage === 'hearing' ? 'feedback.consent_hint' : 'feedback.help_ai_hint')}
            </span>
          </div>
        </form>
      )}
      {stage === 'done' && (
        <button className="pufi-finish" onClick={onClose}>
          {t('feedback.done')}
        </button>
      )}
    </>
  );
}
