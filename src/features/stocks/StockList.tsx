import { Bookmark, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, Stock } from '../../../shared/domain';
import type { ModalState } from '../../app/types';
import SearchField from '../../components/SearchField';
import { Spinner } from '../../components/Spinner';
import { applicationError, t } from '../../i18n/i18n';
import LegalLinks from '../legal/LegalLinks';
import FirstSteps from '../onboarding/FirstSteps';
import { ArticleCard } from './ArticleCard';

type Props = {
  query: string;
  search: string;
  setQuery: Dispatch<SetStateAction<string>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  reload: () => void;
  stockSource: string;
  setStockSource: Dispatch<SetStateAction<string>>;
  total: number;
  showFirstSteps: boolean;
  firstStepsDone: [boolean, boolean, boolean];
  setModal: Dispatch<SetStateAction<ModalState>>;
  listProjectId: string | null;
  projects: Project[];
  loading: boolean;
  stocks: Stock[];
  openStock: (stock: Stock, tab?: 'question' | 'summary') => void;
  savingStockFavorites: string[];
  toggleStockFavorite: (stock: Stock) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  pageSize: number;
  page: number;
  isMobile: boolean;
};
export function StockList({
  query,
  search,
  setQuery,
  setSearch,
  setPage,
  reload,
  stockSource,
  setStockSource,
  total,
  showFirstSteps,
  firstStepsDone,
  setModal,
  listProjectId,
  projects,
  loading,
  stocks,
  openStock,
  savingStockFavorites,
  toggleStockFavorite,
  setError,
  pageSize,
  page,
  isMobile,
}: Props) {
  return (
    <>
      <section className="stock-section" aria-label={t('ui.app.saved_articles')}>
        <SearchField
          label={t('ui.app.search_articles')}
          placeholder={t('ui.app.search_titles_summaries_and_notes')}
          value={query}
          clearable={Boolean(query || search)}
          onChange={setQuery}
          onSearch={() => {
            setSearch(query.trim());
            setPage(1);
            reload();
          }}
          onClear={() => {
            setQuery('');
            setSearch('');
            setPage(1);
            reload();
          }}
        />
        <div className="filter-row">
          <div className="filters" aria-label={t('ui.app.stock_filters')}>
            {[
              ['all', t('ui.app.all')],
              ['web', 'web'],
              ['user', t('ui.app.text')],
              ['favorites', t('ui.app.favorites')],
            ].map(([value, label]) => (
              <button
                key={value}
                className={stockSource === value ? 'selected' : ''}
                aria-pressed={stockSource === value}
                onClick={() => {
                  setStockSource(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="result-count">{t('count.items', { count: total })}</span>
        </div>
        {showFirstSteps && (
          <FirstSteps
            done={firstStepsDone}
            onProject={() => setModal({ type: 'project' })}
            onStock={() => setModal({ type: 'save' })}
            onQuestion={() =>
              setModal({
                type: 'question',
                projectId: listProjectId ?? projects.find((project) => project.count > 0)?.id,
              })
            }
          />
        )}
        {loading && !stocks.length ? (
          <div className="empty-state">
            <Spinner />
            <p>{t('ui.app.loading_articles')}</p>
          </div>
        ) : !stocks.length ? (
          !showFirstSteps && (
            <div className="empty-state">
              <span className="empty-icon">
                <Bookmark size={28} aria-hidden="true" />
              </span>
              <h2>
                {search || stockSource !== 'all'
                  ? t('ui.app.no_matching_articles')
                  : t('ui.app.start_growing_your_knowledge_here')}
              </h2>
              <p>
                {search || stockSource !== 'all'
                  ? t('ui.app.try_a_different_search_or_filter')
                  : t('ui.app.save_a_url_or_text_summaries_and_memory_update')}
              </p>
              {!search && stockSource === 'all' && (
                <button
                  className="button primary"
                  onClick={() => setModal(projects.length ? { type: 'save' } : { type: 'project' })}
                >
                  <Plus size={17} aria-hidden="true" />
                  {projects.length
                    ? t('ui.app.save_your_first_article')
                    : t('ui.app.create_project')}
                </button>
              )}
            </div>
          )
        ) : (
          <div className="article-grid">
            {stocks.map((stock) => (
              <ArticleCard
                key={stock.id}
                stock={stock}
                onOpen={() => openStock(stock)}
                favoriteBusy={savingStockFavorites.includes(stock.id)}
                onFavorite={() => {
                  void toggleStockFavorite(stock).catch((e: Error) =>
                    setError(applicationError(e.message)),
                  );
                }}
              />
            ))}
          </div>
        )}
        {total > pageSize && (
          <div className="pagination">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => {
                setPage((value) => value - 1);
                if (isMobile) window.scrollTo(0, 0);
              }}
            >
              <ChevronLeft size={17} aria-hidden="true" />
              {t('ui.app.previous')}
            </button>
            <span>
              {page} / {Math.ceil(total / pageSize)}
            </span>
            <button
              className="button secondary"
              disabled={page * pageSize >= total}
              onClick={() => {
                setPage((value) => value + 1);
                if (isMobile) window.scrollTo(0, 0);
              }}
            >
              {t('ui.app.next')}
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
        <footer className="library-footer">
          <LegalLinks newTab />
        </footer>
      </section>
    </>
  );
}
