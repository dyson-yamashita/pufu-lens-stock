import { ArrowLeft, ArrowRight, BookOpen, Folder } from 'lucide-react';
import { useState } from 'react';
import type {
  PublicList,
  PublicPufuSummary,
  PublicQuestion,
  PublicStock,
} from '../../../shared/public-project';
import { pufuDisplayTitle } from '../../../shared/pufu';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import QuestionLabels from '../questions/QuestionLabels';
import { initialPublicPage, publicLink } from './public-routing';
import { Pagination } from './PublicLayout';
import { PublicStockCard } from './PublicStocks';
import { ResourceState } from './ResourceState';
import { ShareLink } from './ShareLink';
import type { PublicListProps } from './types';
import { useResource } from './useResource';

export function PublicQuestionCard({ question }: { question: PublicQuestion }) {
  useLanguage();
  return (
    <a
      className="public-content-card public-question-card"
      href={publicLink(`#question/${encodeURIComponent(question.id)}`)}
    >
      <QuestionLabels
        question={{ source: question.source, has_pufu: question.pufu_count > 0 ? 1 : 0 }}
      />
      <h3>{question.text}</h3>
      {(
        question.stocks ??
        (question.stock_id ? [{ id: question.stock_id, title: question.article_title }] : [])
      ).map((stock) => (
        <p key={stock.id} className="public-help">
          {stock.title}
        </p>
      ))}
      {question.pufu_count > 0 && (
        <div className="public-card-footer">
          <span>{t('ui.public_projects.value_pufu', { value0: question.pufu_count })}</span>
        </div>
      )}
    </a>
  );
}

export function PublicQuestionList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicQuestion>>(
    `${root}/questions?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">
          {t('ui.public_projects.no_questions_or_insights_available_for_publication_yet')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}

export function PublicQuestionDetail({
  root,
  publicId,
  id,
  projectName,
}: {
  root: string;
  publicId: string;
  id: string;
  projectName: string;
}) {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<{
    question: PublicQuestion;
    stock: PublicStock | null;
    stocks?: PublicStock[];
    pufus: PublicPufuSummary[];
    has_more: boolean;
  }>(`${root}/questions/${encodeURIComponent(id)}?page=${page}`);
  const stocks = data?.stocks ?? (data?.stock ? [data.stock] : []);
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section
      className="question-detail-page public-question-detail"
      aria-label={t('ui.public_projects.question_or_insight_details')}
    >
      <a className="back-link" href={publicLink('#questions')}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('ui.public_projects.back_to_questions_insights')}
      </a>
      <header className="page-header share-anchor">
        <div>
          <h2 className="page-title">{t('ui.public_projects.question_or_insight_details')}</h2>
          <p>{t('ui.public_projects.reflect_on_a_question_or_insight_and_take_the')}</p>
        </div>
        <ShareLink source={{ publicId }} target={{ kind: 'question', id: data.question.id }} />
      </header>
      <article className="question-detail-card">
        <div className="question-detail-meta">
          <QuestionLabels
            question={{
              source: data.question.source,
              has_pufu: data.question.pufu_count > 0 ? 1 : 0,
            }}
          />
          <span>
            <Folder size={15} aria-hidden="true" />
            {projectName}
          </span>
        </div>
        <h3 className="question-text">{data.question.text}</h3>
        {(data.question.stocks ?? (data.stock ? [data.stock] : [])).map((stock) => (
          <div className="question-detail-source" key={stock.id}>
            <a href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}>
              <BookOpen size={17} aria-hidden="true" />
              <span>{stock.title}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        ))}
        <div className="question-card-footer">
          <time dateTime={data.question.created_at}>
            {new Intl.DateTimeFormat(intlLocale(), {
              dateStyle: 'medium',
              timeZone: 'Asia/Tokyo',
            }).format(new Date(data.question.created_at))}
          </time>
        </div>
      </article>
      <div className="section-head pufu-list-heading">
        <div>
          <h3 className="section-title">
            {t('ui.public_projects.pufu_for_this_question_or_insight')}
          </h3>
          <p>{t('ui.public_projects.view_ideas_organized_by_task')}</p>
        </div>
        <span className="result-count">
          {t('count.items', { count: data.question.pufu_count })}
        </span>
      </div>
      {data.pufus.length ? (
        <div className="pufu-list">
          {data.pufus.map((pufu) => (
            <a
              className="pufu-list-item"
              key={pufu.id}
              href={publicLink(`#pufu/${encodeURIComponent(pufu.id)}`)}
            >
              <span>
                <strong>{pufuDisplayTitle(pufu)}</strong>
                <small>
                  {t('phase.number', { number: pufu.current_phase })}
                  {t('ui.public_projects.read_only')}
                </small>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="pufu-empty">
          <p>{t('ui.public_projects.no_pufu_for_this_question_or_insight_yet')}</p>
        </div>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
      {stocks.length > 0 && (
        <section aria-label={t('ui.app.source_articles')}>
          <h3 className="public-detail-title">{t('ui.app.source_articles')}</h3>
          <div className="public-content-grid">
            {stocks.map((stock) => (
              <PublicStockCard key={stock.id} stock={stock} heading="h4" />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
