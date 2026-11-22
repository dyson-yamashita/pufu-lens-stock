import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { PublicList, PublicStock, PublicStockDetail } from '../../../shared/public-project';
import { isYouTubeUrl, youtubeDisplayTitle } from '../../../shared/youtube';
import LinkedText from '../../components/LinkedText';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import OgImage from '../stocks/OgImage';
import StockImageCarousel from '../stocks/StockImageCarousel';
import YouTubePlayer from '../stocks/YouTubePlayer';
import YouTubeThumbnail from '../stocks/YouTubeThumbnail';
import { initialPublicPage, publicLink } from './public-routing';
import { Pagination } from './PublicLayout';
import { PublicQuestionCard } from './PublicQuestions';
import { PublicViewCount } from './PublicViewCount';
import { ResourceState } from './ResourceState';
import type { PublicListProps } from './types';
import { useResource } from './useResource';

function StockTopics({ stock }: { stock: PublicStock }) {
  useLanguage();
  return (
    stock.summary && (
      <div className="public-topics">
        {stock.summary.topics.map((topic, i) => (
          <span key={i}>{topic}</span>
        ))}
      </div>
    )
  );
}

export function PublicStockCard({
  stock,
  heading: Heading = 'h3',
}: {
  stock: PublicStock;
  heading?: 'h3' | 'h4';
}) {
  useLanguage();
  const youtube = Boolean(stock.source_url && isYouTubeUrl(stock.source_url));
  const site = stock.domain || t('ui.app.text');
  const title = (youtube ? youtubeDisplayTitle(stock.title) : stock.title).trim() || site;
  const href = publicLink(`#stock/${encodeURIComponent(stock.id)}`);
  return (
    <article className="public-content-card public-stock-card">
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {site}
        <time>{new Date(stock.created_at).toLocaleDateString(intlLocale())}</time>
      </p>
      <Heading className="public-stock-card-title">
        <a className="public-stock-card-link" href={href}>
          {title}
        </a>
      </Heading>
      <p className="public-summary">
        {youtube
          ? t('ui.public_projects.youtube_link_saved')
          : stock.summary?.overview || t('ui.public_projects.no_summary_yet')}
      </p>
      <StockImageCarousel
        images={stock.images ?? []}
        preview={{ href, openLabel: t('ui.app.open_details_for_value', { value0: title }) }}
      />
      {!youtube && stock.og_image_url && (
        <div className="article-og-preview">
          <OgImage src={stock.og_image_url} />
        </div>
      )}
      {youtube && (
        <div className="youtube-thumbnail">
          <YouTubeThumbnail url={stock.source_url!} />
        </div>
      )}
      <StockTopics stock={stock} />
      <div className="public-card-footer">
        <PublicViewCount count={stock.view_count} />
      </div>
    </article>
  );
}

export function StockDetails({
  stock,
  heading: Heading = 'h3',
}: {
  stock: PublicStock;
  heading?: 'h3' | 'h4';
}) {
  useLanguage();
  const href = stock.source_url && /^https?:\/\//i.test(stock.source_url) ? stock.source_url : null;
  const youtube = Boolean(href && isYouTubeUrl(href));
  const PointsHeading = Heading === 'h4' ? 'h5' : 'h4';
  return (
    <article className="public-content-card public-stock-detail">
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {stock.domain || t('ui.app.text')}
        <time>{new Date(stock.created_at).toLocaleDateString(intlLocale())}</time>
      </p>
      <Heading className="public-stock-title">
        {youtube ? youtubeDisplayTitle(stock.title) : stock.title}
      </Heading>
      {!youtube && <OgImage src={stock.og_image_url} />}
      {youtube ? (
        <YouTubePlayer url={href!} />
      ) : (
        <p className="public-summary">
          <LinkedText text={stock.summary?.overview || t('ui.public_projects.no_summary_yet')} />
        </p>
      )}
      <StockImageCarousel images={stock.images ?? []} />
      {!youtube && stock.summary && stock.summary.keyPoints.length > 0 && (
        <section className="public-stock-points" aria-label={t('ui.public_projects.key_points')}>
          <PointsHeading>{t('ui.public_projects.key_points')}</PointsHeading>
          <ul>
            {stock.summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}
      <StockTopics stock={stock} />
      {href && (
        <a className="text-link" href={href} target="_blank" rel="noreferrer">
          {youtube ? t('ui.app.open_on_youtube') : t('ui.app.open_original_article')}{' '}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}

export function PublicStockDetailPage({ root, id }: { root: string; id: string }) {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<PublicStockDetail>(
    `${root}/stocks/${encodeURIComponent(id)}?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section aria-label={t('ui.public_projects.stock_details')}>
      <a className="text-link" href={publicLink('#stocks')}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('ui.public_projects.back_to_stocks')}
      </a>
      <div className="public-count-row">
        <h2 className="public-detail-title">{t('ui.public_projects.stock_details')}</h2>
        <PublicViewCount count={data.stock.view_count} />
      </div>
      <StockDetails stock={data.stock} />
      <h3 className="public-detail-title">{t('ui.public_projects.related_questions_insights')}</h3>
      <div className="public-content-grid">
        {data.questions.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.questions.length && (
        <p className="public-message">
          {t('ui.public_projects.this_stock_has_no_questions_or_insights_available_for')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
    </section>
  );
}

export function PublicStockList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicStock>>(
    `${root}/stocks?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((stock) => (
          <PublicStockCard key={stock.id} stock={stock} />
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">{t('ui.public_projects.no_stocks_yet')}</p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
