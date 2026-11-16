import { BookOpen, Folder, Globe } from 'lucide-react';
import type { Stock } from '../../../shared/domain';
import { isYouTubeUrl, youtubeDisplayTitle } from '../../../shared/youtube';
import { applicationError, intlLocale, t, useLanguage } from '../../i18n/i18n';
import { statusLabels } from './stock-labels';
import { StockFavoriteButton } from './StockFavoriteButton';
import YouTubeThumbnail from './YouTubeThumbnail';

export function ArticleCard({
  stock,
  onOpen,
  onFavorite,
  favoriteBusy,
}: {
  stock: Stock;
  onOpen: () => void;
  onFavorite: () => void;
  favoriteBusy: boolean;
}) {
  useLanguage();
  const youtube = stock.source_type === 'url' && isYouTubeUrl(stock.source_url);
  return (
    <article className="article-card">
      <div className="article-meta">
        <span className="site-mark">
          {stock.source_type === 'text' ? (
            <BookOpen size={13} aria-hidden="true" />
          ) : (
            <Globe size={13} aria-hidden="true" />
          )}
        </span>
        <span className="domain truncate">
          {stock.source_type === 'text' ? t('ui.app.text') : stock.domain.replace('www.', '')}
        </span>
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>
            {stock.status !== 'failed' && <span className="status-dot" />}
            {statusLabels()[stock.status]}
          </span>
        )}
        <span className="article-project">
          <Folder size={13} aria-hidden="true" />
          <span className="truncate">{stock.project_name}</span>
        </span>
      </div>
      <div className="article-content">
        <h2 className="article-title">
          <button type="button" className="article-open" onClick={onOpen}>
            {youtube ? youtubeDisplayTitle(stock.title) : stock.title}
          </button>
        </h2>
        <p className="article-summary">
          {youtube
            ? t('ui.app.youtube_link_saved_open_the_details_to_view_the')
            : (stock.summary?.overview ??
              (applicationError(stock.error) || undefined) ??
              (stock.source_type === 'text'
                ? t('ui.app.summarizing_the_key_points_from_your_saved_text')
                : t('ui.app.retrieving_the_article_and_summarizing_its_key_points_you')))}
        </p>
      </div>
      {youtube && (
        <button
          type="button"
          className="youtube-thumbnail"
          aria-label={t('ui.app.open_details_for_value', {
            value0: youtubeDisplayTitle(stock.title),
          })}
          onClick={onOpen}
        >
          <YouTubeThumbnail url={stock.source_url} />
        </button>
      )}
      <div className="article-tags">
        {stock.summary?.topics.slice(0, 3).map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
      </div>
      <footer>
        <time dateTime={stock.created_at}>
          {new Intl.DateTimeFormat(intlLocale(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Tokyo',
          }).format(new Date(stock.created_at))}
        </time>
        <StockFavoriteButton stock={stock} busy={favoriteBusy} onClick={onFavorite} />
      </footer>
    </article>
  );
}
