import { ArrowDownToLine, ArrowUpRight, BookOpen, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { MemoryVersion, Project } from '../../../shared/domain';
import { Spinner } from '../../components/Spinner';
import { applicationError, t, useLanguage } from '../../i18n/i18n';
import { date } from '../../lib/dates';
import MemoryHistory from './MemoryHistory';
import MemoryKnowledge from './MemoryKnowledge';
import type { MemoryResponse } from './types';

export function MemoryPanel({
  response,
  project,
  historyProjectId,
  full = false,
  onRebuild,
  onEvidence,
}: {
  response: MemoryResponse;
  project?: Project;
  historyProjectId?: string;
  full?: boolean;
  onRebuild?: () => void;
  onEvidence: (id: string) => Promise<void>;
}) {
  useLanguage();
  const [historical, setHistorical] = useState<MemoryVersion | null>(null);
  const memory = historical ? { ...historical, updated_at: historical.saved_at } : response.memory;
  const data = memory?.data;
  return (
    <section className={`memory-card ${full ? 'full-memory' : ''}`}>
      <div className="memory-head">
        <span className="memory-symbol">
          <Sparkles size={20} aria-hidden="true" />
        </span>
        <div>
          <div className="eyebrow">GROWING MEMORY</div>
          <h2>{project ? t('ui.app.project_memory') : t('ui.app.your_memory')}</h2>
        </div>
        {response.pending && (
          <span className="memory-pending" aria-label={t('ui.app.updating_memory')}>
            <Spinner />
          </span>
        )}
      </div>
      <p className="memory-caption">
        {project
          ? t('ui.app.from_the_articles_collected_in_this_project')
          : t('ui.app.interests_across_eligible_projects')}
      </p>
      {full && (
        <MemoryHistory
          projectId={historyProjectId}
          currentRevision={response.memory?.revision}
          updatedAt={response.memory?.updated_at}
          onSelect={setHistorical}
        />
      )}
      {historical && (
        <div className="memory-history-notice" role="status">
          <strong>{t('ui.memory_history.viewing', { revision: historical.revision })}</strong>
          <p>{t('ui.memory_history.historical_note')}</p>
        </div>
      )}
      {!historical && response.coverage?.full_rebuild_reason && (
        <p className="update-note">{applicationError(response.coverage.full_rebuild_reason)}</p>
      )}
      {!historical && response.pending && (
        <p className="update-note">{t('ui.app.incorporating_new_articles')}</p>
      )}
      {response.error && (
        <p className="form-error" role="alert">
          {applicationError(response.error)}
        </p>
      )}
      {!data?.interests.length && !data?.knowledge.length && !data?.questions.length ? (
        <div className="memory-empty">
          <div className="memory-seed">
            <span />
            <span />
            <span />
          </div>
          <p>
            {t('ui.app.as_your_article_collection_grows')}
            <br />
            {t('ui.app.your_interests_and_knowledge_connect_here')}
          </p>
        </div>
      ) : (
        <>
          <div className="memory-block">
            <h3>
              <span />
              {t('ui.app.interest_patterns')}
            </h3>
            <ul>
              {data.interests.slice(0, full ? 8 : 3).map((interest, index) => (
                <li key={index}>{interest}</li>
              ))}
            </ul>
          </div>
          <div className="memory-block knowledge">
            <h3>
              <BookOpen size={14} aria-hidden="true" />
              {t('ui.app.knowledge_from_articles')}
            </h3>
            <ul>
              {data.knowledge.slice(0, full ? 12 : 2).map((item, index) => (
                <li key={index}>
                  <MemoryKnowledge text={item.text}>
                    {item.articleIds.slice(0, full ? 5 : 1).map((id, sourceIndex) => (
                      <button key={id} onClick={() => void onEvidence(id)}>
                        {t('ui.app.source_articles')}
                        {item.articleIds.length > 1 ? ` ${sourceIndex + 1}` : ''}
                        <ArrowUpRight size={11} aria-hidden="true" />
                      </button>
                    ))}
                  </MemoryKnowledge>
                </li>
              ))}
            </ul>
          </div>
          {full && data.questions.length > 0 && (
            <div className="memory-block">
              <h3>{t('ui.app.open_questions')}</h3>
              <ul>
                {data.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="memory-foot">
        <span>
          {memory
            ? t('ui.app.generated_from_value_articles_updated_value', {
                value0: memory.article_count,
                value1: date(memory.updated_at),
              })
            : t('ui.app.updates_after_article_summaries')}
        </span>
      </div>
      {full && (
        <>
          <p className="memory-disclaimer">
            {t('ui.app.saving_an_article_does_not_imply_agreement_with_its')}
          </p>
          <div className="memory-controls">
            <button
              className="button secondary"
              disabled={response.pending || Boolean(historical)}
              onClick={onRebuild}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {t('ui.app.regenerate')}
            </button>
            {memory && (
              <button
                className="button secondary"
                onClick={() => {
                  const blob = new Blob([memory.text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = t('ui.app.value_memory_txt', {
                    value0: project?.name ?? t('ui.app.user'),
                  });
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <ArrowDownToLine size={16} aria-hidden="true" />
                {t('ui.app.save_text')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
