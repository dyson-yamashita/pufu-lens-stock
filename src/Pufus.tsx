import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Network } from 'lucide-react';
import { pufuDisplayTitle, type PufuListItem } from '../shared/pufu';
import { api } from './api';
import PufuFavoriteButton from './PufuFavoriteButton';
const statusLabels = () => ({
  queued: t('ui.pufus.queued'),
  generating: t('ui.pufus.generating'),
  ready: t('ui.pufus.created'),
  failed: t('ui.pufus.generation_failed'),
});
export default function Pufus({
  projectId,
  refresh,
  active,
  onPufu,
}: {
  projectId: string | null;
  refresh: number;
  active: boolean;
  onPufu: (id: string) => void;
}) {
  useLanguage();
  const [pufus, setPufus] = useState<PufuListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favoriteVersion = useRef(0);
  useEffect(() => setPage(1), [projectId]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let inFlight = false;
    setLoading(true);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = favoriteVersion.current;
      const params = new URLSearchParams({ page: String(page) });
      if (favoritesOnly) params.set('favorite', 'true');
      if (projectId) params.set('project_id', projectId);
      try {
        const result = await api<{
          pufus: PufuListItem[];
          total: number;
        }>(`/api/v1/pufus?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted && version === favoriteVersion.current) {
          setPufus(result.pufus);
          setTotal(result.total);
          setError('');
          if (page > Math.max(1, Math.ceil(result.total / 24)))
            setPage(Math.max(1, Math.ceil(result.total / 24)));
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
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
  }, [projectId, page, refresh, retry, active, favoritesOnly]);
  return (
    <section className="questions-page" aria-label={t('ui.pufus.saved_pufu')}>
      <div className="filter-row">
        <div className="filters" aria-label={t('ui.pufus.pufu_filters')}>
          {[
            [false, t('ui.app.all')],
            [true, t('ui.app.favorites')],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              aria-pressed={favoritesOnly === value}
              className={favoritesOnly === value ? 'selected' : ''}
              onClick={() => {
                setFavoritesOnly(value === true);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="result-count">{t('count.items', { count: total })}</span>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button className="button text-button" onClick={() => setRetry((value) => value + 1)}>
            {t('ui.app.reload')}
          </button>
        </div>
      )}
      {loading && !pufus.length ? (
        <div className="empty-state">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <p>{t('ui.pufus.loading_pufu')}</p>
        </div>
      ) : !pufus.length ? (
        !error && (
          <div className="empty-state">
            <span className="empty-icon">
              <Network className="pufu-icon" size={28} aria-hidden="true" />
            </span>
            <h2>{favoritesOnly ? t('ui.pufus.no_favorite_pufu') : t('ui.pufus.no_pufu_yet')}</h2>
            <p>
              {favoritesOnly
                ? t('ui.pufus.use_the_star_button_on_a_pufu_to_add')
                : t('ui.pufus.choose_add_pufu_and_enter_a_gaining_goal_to')}
            </p>
          </div>
        )
      ) : (
        <div className="pufu-list">
          {pufus.map((pufu) => {
            const questions =
              pufu.questions ??
              (pufu.question_id ? [{ id: pufu.question_id, text: pufu.question_text }] : []);
            const stocks = pufu.stocks ?? [];
            return (
              <article key={pufu.id} className="pufu-list-item">
                <button type="button" className="pufu-list-open" onClick={() => onPufu(pufu.id)}>
                  <span>
                    <strong>{pufuDisplayTitle(pufu)}</strong>
                    {questions.length > 0 && (
                      <small>
                        {t('ui.pufus.question_or_insight')}
                        {questions[0].text}
                        {questions.length > 1 &&
                          t('ui.pufus.value_more', { value0: questions.length - 1 })}
                      </small>
                    )}
                    {stocks.length > 0 && (
                      <small>
                        {t('ui.pufus.stock')}
                        {stocks[0].title}
                        {stocks.length > 1 &&
                          t('ui.pufus.value_more', { value0: stocks.length - 1 })}
                      </small>
                    )}
                    <small>
                      {pufu.project_name} · {statusLabels()[pufu.status]} ·{' '}
                      {t('phase.number', { number: pufu.current_phase })}
                    </small>
                  </span>
                </button>
                <div className="pufu-list-footer">
                  <time dateTime={pufu.created_at}>
                    {new Intl.DateTimeFormat(intlLocale(), {
                      dateStyle: 'medium',
                      timeZone: 'Asia/Tokyo',
                    }).format(new Date(pufu.created_at))}
                  </time>
                  <PufuFavoriteButton
                    pufu={pufu}
                    onError={setError}
                    onBusyChange={() => {
                      favoriteVersion.current += 1;
                    }}
                    onSaved={(saved) => {
                      setPufus((items) =>
                        items.map((item) =>
                          item.id === saved.id ? { ...item, is_favorite: saved.is_favorite } : item,
                        ),
                      );
                      setRetry((value) => value + 1);
                    }}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
      {total > 24 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
            {t('ui.app.previous')}
          </button>
          <span>
            {page} / {Math.ceil(total / 24)}
          </span>
          <button
            className="button secondary"
            disabled={page * 24 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('ui.app.next')}
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
