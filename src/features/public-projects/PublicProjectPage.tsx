import { ArrowRight, CircleHelp, Globe, Layers, Network } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { PublicProjectDetail } from '../../../shared/public-project';
import { publicHash } from '../../../shared/public-route';
import { manualHref, t, useLanguage } from '../../i18n/i18n';
import { initialPublicPage, publicLink } from './public-routing';
import { PublicBrand } from './PublicLayout';
import { PublicPufuDetail } from './PublicPufuDetail';
import { PublicPufuList } from './PublicPufuList';
import { PublicQuestionDetail, PublicQuestionList } from './PublicQuestions';
import { PublicStockDetailPage, PublicStockList } from './PublicStocks';
import { PublicViewCount } from './PublicViewCount';
import { PublicPageSkeleton, ResourceState } from './ResourceState';
import { useResource } from './useResource';

export default function PublicProjectPage({ publicId }: { publicId: string }) {
  const { language } = useLanguage();
  const root = `/api/public/projects/${encodeURIComponent(publicId)}`;
  const { data, error, reload } = useResource<{
    project: PublicProjectDetail;
  }>(root);
  const [hash, setHash] = useState(
    publicHash(window.location.pathname ?? '', window.location.search ?? '', window.location.hash),
  );
  const [stockPage, setStockPage] = useState(initialPublicPage);
  const [questionPage, setQuestionPage] = useState(initialPublicPage);
  const [pufuPage, setPufuPage] = useState(initialPublicPage);
  useEffect(() => {
    const listener = () => {
      setHash(
        publicHash(
          window.location.pathname ?? '',
          window.location.search ?? '',
          window.location.hash,
        ),
      );
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const match = /^#(stock|question|pufu)\/([^/?]+)(?:\?from=(pufus))?$/.exec(hash);
  let content: ReactNode;
  if (match)
    content =
      match[1] === 'stock' ? (
        <PublicStockDetailPage key={match[2]} root={root} id={match[2]} />
      ) : match[1] === 'pufu' ? (
        <PublicPufuDetail
          key={`${root}-${match[2]}`}
          root={root}
          id={match[2]}
          fromList={match[3] === 'pufus'}
        />
      ) : (
        <PublicQuestionDetail
          key={match[2]}
          root={root}
          id={match[2]}
          projectName={data?.project.name ?? ''}
        />
      );
  else
    content =
      hash === '#pufus' ? (
        <PublicPufuList root={root} page={pufuPage} onPageChange={setPufuPage} />
      ) : hash === '#questions' ? (
        <PublicQuestionList root={root} page={questionPage} onPageChange={setQuestionPage} />
      ) : (
        <PublicStockList root={root} page={stockPage} onPageChange={setStockPage} />
      );
  return (
    <div className="public-page">
      <header className="public-header">
        <PublicBrand />
        <a className="text-link" href="/">
          {t('ui.public_projects.home')}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </header>
      <main className="public-main">
        {!data && error ? (
          <ResourceState error={error} retry={reload} />
        ) : !data ? (
          <PublicPageSkeleton />
        ) : (
          <>
            <span className="public-badge">
              <Globe size={14} aria-hidden="true" />
              {t('ui.public_projects.public')}
            </span>
            <div className="public-count-row">
              <h1>{data.project.name}</h1>
              {!match && <PublicViewCount count={data.project.view_count} />}
            </div>
            {data.project.public_description && (
              <p className="public-lead">{data.project.public_description}</p>
            )}
            <nav className="public-tabs" aria-label={t('ui.public_projects.public_projects')}>
              <a
                href={publicLink('#stocks')}
                aria-current={
                  match?.[1] === 'stock' || (!match && !['#questions', '#pufus'].includes(hash))
                    ? 'page'
                    : undefined
                }
              >
                <Layers size={18} aria-hidden="true" />
                {t('ui.app.stocks')}
                <span>{data.project.stock_count}</span>
              </a>
              <a
                href={publicLink('#questions')}
                aria-current={
                  hash === '#questions' || match?.[1] === 'question' ? 'page' : undefined
                }
              >
                <CircleHelp size={18} aria-hidden="true" />
                {t('ui.app.questions_insights')}
                <span>{data.project.question_count}</span>
              </a>
              <a
                href={publicLink('#pufus')}
                aria-current={hash === '#pufus' || match?.[1] === 'pufu' ? 'page' : undefined}
              >
                <Network size={18} aria-hidden="true" />
                {t('ui.app.pufu')}
                <span>{data.project.pufu_count}</span>
              </a>
            </nav>
            {(hash === '#pufus' || match?.[1] === 'pufu') && (
              <p className="public-help public-pufu-help">
                {t('ui.public_projects.pufu_help')}{' '}
                <a className="text-link" href={`${manualHref(language)}#pufu`}>
                  {t('ui.public_projects.learn_more_about_pufu')}
                </a>
              </p>
            )}
            {content}
          </>
        )}
      </main>
      <footer className="public-footer">
        {t('ui.public_projects.pufu_lens_connect_knowledge_into_memory')}
      </footer>
    </div>
  );
}
