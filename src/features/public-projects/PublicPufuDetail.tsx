import { ArrowLeft, Triangle } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { PublicPufu } from '../../../shared/public-project';
import { t, useLanguage } from '../../i18n/i18n';
import { publicLink } from './public-routing';
import { PublicPufuScoreSkeleton, ResourceState } from './ResourceState';
import { ShareLink } from './ShareLink';
import { useResource } from './useResource';

const PublicPufuScore = lazy(async () => {
  try {
    return await import('./PublicPufuScore');
  } catch {
    return {
      default: () => (
        <ResourceState
          error={t('ui.public_projects.could_not_load_the_pufu_image_please_reload')}
          retry={() => window.location.reload()}
        />
      ),
    };
  }
});

export function PublicPufuDetail({
  root,
  publicId,
  id,
  fromList,
}: {
  root: string;
  publicId: string;
  id: string;
  fromList: boolean;
}) {
  useLanguage();
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<number | undefined>(() => {
    const value = new URLSearchParams(window.location.search ?? '').get('phase');
    return value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
  });
  const { data, error, reload } = useResource<{
    pufu: PublicPufu;
  }>(
    `${root}/pufus/${encodeURIComponent(id)}${selectedPhase === undefined ? '' : `?phase=${selectedPhase}`}`,
  );
  const phase = data ? (data.pufu.phase ?? data.pufu.current_phase) : 1;
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section>
      <a
        className="text-link"
        href={publicLink(
          fromList
            ? '#pufus'
            : data.pufu.question_id
              ? `#question/${encodeURIComponent(data.pufu.question_id)}`
              : '#questions',
        )}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {fromList
          ? t('ui.app.back_to_pufu_list')
          : data.pufu.question_id
            ? t('ui.public_projects.back_to_question_or_insight')
            : t('ui.public_projects.back_to_questions_insights')}
      </a>
      <h2 className="public-detail-title">{data.pufu.title || t('ui.app.pufu')}</h2>
      <div className="pufu-context public-pufu-context">
        <section aria-label={t('ui.public_projects.task')}>
          <h3 className="question-origin pufu-context-label">{t('ui.public_projects.task')}</h3>
          <ul className="pufu-context-questions">
            <li>{data.pufu.task}</li>
          </ul>
        </section>
        {(data.pufu.questions?.length || data.pufu.question_id) && (
          <details className="pufu-related pufu-related-questions">
            <summary>{t('ui.public_projects.related_questions_insights')}</summary>
            <ul className="pufu-context-questions">
              {(
                data.pufu.questions ??
                (data.pufu.question_id
                  ? [{ id: data.pufu.question_id, text: data.pufu.question_text }]
                  : [])
              ).map((question) => (
                <li key={question.id}>
                  <a
                    className="text-link"
                    href={publicLink(`#question/${encodeURIComponent(question.id)}`)}
                  >
                    {question.text}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        {Boolean(data.pufu.stocks?.length) && (
          <details className="pufu-related pufu-related-stocks">
            <summary>{t('ui.public_projects.related_stocks')}</summary>
            <ul className="pufu-context-questions">
              {data.pufu.stocks?.map((stock) => (
                <li key={stock.id}>
                  <a
                    className="text-link"
                    href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}
                  >
                    {stock.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="public-badge">
        {t('phase.number', { number: phase })} ·{' '}
        {phase % 2 === 0 ? t('ui.public_projects.reflection') : t('ui.app.pufu')}
        {t('ui.public_projects.read_only')}
      </p>
      <div className="pufu-toolbar public-pufu-toolbar share-anchor">
        <div
          className="pufu-phase-navigation"
          data-share-phase-navigation
          role="group"
          aria-label={t('ui.pufu_editor.switch_phase')}
        >
          {phase > 1 && (
            <button
              className="icon-button pufu-phase-previous"
              aria-label={t('ui.pufu_editor.previous_phase')}
              onClick={() => setSelectedPhase(phase - 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
          <span className="pufu-phase-number" aria-live="polite">
            {t('phase.number', { number: phase })}
          </span>
          {phase < data.pufu.current_phase && (
            <button
              className="icon-button pufu-phase-next"
              aria-label={t('ui.pufu_editor.next_phase')}
              onClick={() => setSelectedPhase(phase + 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
        </div>
        <ShareLink
          source={{ publicId }}
          target={{ kind: 'pufu', id: data.pufu.id, phase }}
          visibility={{ open: shareOpen, onChange: setShareOpen }}
        />
      </div>
      <Suspense fallback={<PublicPufuScoreSkeleton />}>
        <PublicPufuScore key={`${id}-${phase}`} score={data.pufu.score} phase={phase} />
      </Suspense>
    </section>
  );
}
