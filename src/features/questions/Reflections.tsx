import { BookOpen, ChevronDown, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../../shared/domain';
import {
  recentReflectionDays,
  reflectionDay,
  reflectionWeekStart,
  type Reflection,
  type ReflectionList,
} from '../../../shared/reflections';
import { applicationError, intlLocale, t, useLanguage } from '../../i18n/i18n';
import { api, createRequestId, send } from '../../lib/api';
import { date } from '../../lib/dates';

type OpenSources = {
  onStock: (id: string) => Promise<void>;
  onPufu?: (id: string) => void;
};

function ReflectionCard({
  reflection,
  showProject,
  onUpdate,
  onStock,
  onPufu,
}: OpenSources & {
  reflection: Reflection;
  showProject: boolean;
  onUpdate: () => void;
}) {
  const label = useId();
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const format = new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  });
  const range = format.formatRange(
    new Date(reflection.start_at),
    new Date(Date.parse(reflection.end_at) - 1),
  );
  const currentWeek = Date.parse(reflection.end_at) === reflectionWeekStart(Date.now());
  const update = async (action: 'answer' | 'dismiss' | 'alternative' | 'retry') => {
    setPending(true);
    setError('');
    try {
      await send(
        `/api/v1/reflections/${encodeURIComponent(reflection.id)}`,
        { action, generation: reflection.generation, ...(action === 'answer' && { answer }) },
        'PATCH',
      );
      onUpdate();
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setPending(false);
    }
  };
  const canRespond = !reflection.answer && reflection.status !== 'queued';
  return (
    <article className="reflection-card">
      <h3>
        {t(reflection.is_weekly && currentWeek ? 'reflection.weekly' : 'reflection.question')}
      </h3>
      <p className="field-hint">
        {showProject ? `${reflection.project_name} · ` : ''}
        {range}
      </p>
      {reflection.text && <p className="question-text">{reflection.text}</p>}
      {reflection.status === 'queued' && (
        <p className="question-message" role="status">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          {t('reflection.generating')}
        </p>
      )}
      {reflection.status === 'empty' && (
        <p className="question-message" role="status">
          {t(reflection.text ? 'reflection.no_alternative' : 'reflection.no_question')}
        </p>
      )}
      {reflection.status === 'failed' && (
        <p className="form-error" role="alert">
          {t('reflection.failed')}
        </p>
      )}
      {(reflection.stocks.length > 0 || (onPufu && reflection.pufus.length > 0)) && (
        <div className="reflection-sources">
          <p className="field-hint">{t('reflection.sources')}</p>
          <ul>
            {reflection.stocks.map((stock) => (
              <li key={stock.id}>
                <button
                  type="button"
                  className="button text-button"
                  onClick={() => {
                    setError('');
                    void onStock(stock.id).catch((e: Error) =>
                      setError(applicationError(e.message)),
                    );
                  }}
                >
                  <time dateTime={stock.created_at}>{date(stock.created_at)}</time>
                  {stock.title}
                </button>
              </li>
            ))}
            {onPufu &&
              reflection.pufus.map((pufu) => (
                <li key={pufu.id}>
                  <button
                    type="button"
                    className="button text-button"
                    onClick={() => onPufu(pufu.id)}
                  >
                    {t('ui.app.pufu')} · {pufu.title}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {reflection.answer && (
        <div className="reflection-answer">
          <p className="field-hint">{t('reflection.saved_answer')}</p>
          <p>{reflection.answer}</p>
        </div>
      )}
      {canRespond && (
        <form
          className="question-settings reflection-answer-form"
          onSubmit={(event) => {
            event.preventDefault();
            void update('answer');
          }}
        >
          {reflection.text && (
            <>
              <label htmlFor={label}>{t('reflection.answer')}</label>
              <textarea
                id={label}
                rows={3}
                maxLength={2000}
                value={answer}
                disabled={pending}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </>
          )}
          <div className="reflection-actions">
            {reflection.text && (
              <button className="button primary" type="submit" disabled={!answer.trim() || pending}>
                {t('reflection.save_answer')}
              </button>
            )}
            {reflection.status === 'ready' && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => void update('alternative')}
              >
                {t('reflection.alternative')}
              </button>
            )}
            {reflection.status === 'failed' && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => void update('retry')}
              >
                {t('reflection.retry')}
              </button>
            )}
            <button
              className="button text-button"
              type="button"
              disabled={pending}
              onClick={() => void update('dismiss')}
            >
              {t('reflection.dismiss')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export default function Reflections({
  projects,
  projectId,
  active,
  onStock,
  onPufu,
}: OpenSources & {
  projects: Project[];
  projectId: string | null;
  active: boolean;
}) {
  useLanguage();
  const titleId = useId();
  const [data, setData] = useState<ReflectionList>();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [preset, setPreset] = useState('7');
  const [customDates, setCustomDates] = useState(() => recentReflectionDays(7, Date.now()));
  const request = useRef<{ signature: string; id: string } | null>(null);
  const destinations = projects.filter((p) =>
    projectId ? p.id === projectId : p.show_in_all_lists !== false,
  );
  const destination = destinations.find((p) => p.id === selectedProject)?.id ?? destinations[0]?.id;
  const today = reflectionDay(Date.now());
  const updateList = () => setRefresh((value) => value + 1);
  const hasProjects = destinations.length > 0;

  useEffect(() => {
    if (!active || !hasProjects) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const query = new URLSearchParams({ page: String(page) });
      if (projectId) query.set('project_id', projectId);
      try {
        const result = await api<ReflectionList>(`/api/v1/reflections?${query}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (page > 1 && !result.reflections.length) setPage((value) => value - 1);
        else setData(result);
        setLoadError('');
      } catch (e) {
        if (!controller.signal.aborted) setLoadError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active, hasProjects, projectId, page, refresh]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!destination || busy) return;
    setFormError('');
    const dates =
      preset === 'custom' ? customDates : recentReflectionDays(Number(preset), Date.now());
    const signature = JSON.stringify([destination, dates.from, dates.to]);
    if (request.current?.signature !== signature)
      request.current = { signature, id: createRequestId() };
    setBusy(true);
    try {
      await send('/api/v1/reflections', {
        project_id: destination,
        ...dates,
        request_id: request.current.id,
      });
      request.current = null;
      setPage(1);
      updateList();
    } catch (e) {
      setFormError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!hasProjects) return null;
  return (
    <section className="reflections" aria-labelledby={titleId}>
      <h2 id={titleId}>
        <BookOpen size={18} aria-hidden="true" />
        {t('reflection.heading')}
      </h2>
      {data?.reflections?.length === 0 &&
        destinations.some((project) => project.auto_generate_questions) && (
          <p className="field-hint">{t('reflection.automatic_hint')}</p>
        )}
      <details className="reflection-period">
        <summary>
          {t('reflection.choose_period')}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <form className="question-settings" onSubmit={generate}>
          <div className="reflection-fields">
            {!projectId && (
              <label>
                {t('ui.app.destination_project')}
                <select
                  value={destination}
                  disabled={busy}
                  onChange={(event) => setSelectedProject(event.target.value)}
                >
                  {destinations.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t('reflection.period')}
              <select
                value={preset}
                disabled={busy}
                onChange={(event) => setPreset(event.target.value)}
              >
                <option value="7">{t('reflection.days_7')}</option>
                <option value="30">{t('reflection.days_30')}</option>
                <option value="custom">{t('reflection.custom_dates')}</option>
              </select>
            </label>
            {preset === 'custom' && (
              <>
                <label>
                  {t('reflection.from')}
                  <input
                    type="date"
                    required
                    max={customDates.to || today}
                    value={customDates.from}
                    disabled={busy}
                    onChange={(event) =>
                      setCustomDates({ ...customDates, from: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t('reflection.to')}
                  <input
                    type="date"
                    required
                    min={customDates.from}
                    max={today}
                    value={customDates.to}
                    disabled={busy}
                    onChange={(event) => setCustomDates({ ...customDates, to: event.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          <button type="submit" className="button primary" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            {t('reflection.generate')}
          </button>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </details>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
      {data?.reflections?.map((reflection) => (
        <ReflectionCard
          key={`${reflection.id}:${reflection.generation}`}
          reflection={reflection}
          showProject={!projectId}
          onUpdate={updateList}
          onStock={onStock}
          onPufu={onPufu}
        />
      ))}
      {(page > 1 || data?.has_more) && (
        <div className="reflection-actions">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t('ui.app.previous')}
          </button>
          <button
            className="button secondary"
            disabled={!data?.has_more}
            onClick={() => setPage(page + 1)}
          >
            {t('ui.app.next')}
          </button>
        </div>
      )}
    </section>
  );
}
