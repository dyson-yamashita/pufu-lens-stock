import { applicationError, t, useLanguage } from './i18n';
import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Pufu } from '../shared/pufu';
import { api, send } from './api';
import RelationPicker, { type RelationOption } from './RelationPicker';
export default function PufuRelations({
  pufu,
  blocked,
  onBusy,
  onSaved,
}: {
  pufu: Pufu;
  blocked: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (pufu: Pufu) => void;
}) {
  useLanguage();
  const [questionDraft, setQuestions] = useState<RelationOption[]>();
  const [stockDraft, setStocks] = useState<RelationOption[]>();
  const questions =
    questionDraft ??
    (pufu.questions
      ? pufu.questions.map((question) => ({ id: question.id, label: question.text }))
      : pufu.question_id
        ? [
            {
              id: pufu.question_id,
              label:
                pufu.context.question?.text ?? t('ui.public_projects.related_questions_insights'),
            },
          ]
        : []);
  const stocks =
    stockDraft ??
    (pufu.stocks
      ? pufu.stocks.map((stock) => ({ id: stock.id, label: stock.title }))
      : pufu.context.stock
        ? [{ id: pufu.context.stock.id, label: pufu.context.stock.title }]
        : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    setBusy(true);
    onBusy(true);
    setError('');
    setSaved(false);
    let awaitingReload = reloadPending;
    try {
      if (!reloadPending) {
        await send(
          `/api/v1/pufus/${encodeURIComponent(pufu.id)}/relations`,
          {
            revision: pufu.revision,
            question_ids: questions.map((question) => question.id),
            stock_ids: stocks.map((stock) => stock.id),
          },
          'PATCH',
        );
        awaitingReload = true;
        setReloadPending(true);
      }
      const result = await api<{
        pufu: Pufu;
      }>(`/api/v1/pufus/${encodeURIComponent(pufu.id)}`);
      onSaved(result.pufu);
      awaitingReload = false;
      setReloadPending(false);
      setQuestions(undefined);
      setStocks(undefined);
      setSaved(true);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
      onBusy(awaitingReload);
    }
  }
  return (
    <details className="pufu-relations">
      <summary>{t('ui.pufu_relations.edit_related_questions_insights_and_stocks')}</summary>
      <form onSubmit={save}>
        <p className="field-hint">
          {t('ui.pufu_relations.select_multiple_questions_insights_and_stocks_in_the_same')}
        </p>
        <RelationPicker
          kind="questions"
          projectId={pufu.project_id}
          value={questions}
          onChange={(value) => {
            setQuestions(value);
            setSaved(false);
          }}
          disabled={busy || blocked || reloadPending}
        />
        <RelationPicker
          kind="stocks"
          projectId={pufu.project_id}
          value={stocks}
          onChange={(value) => {
            setStocks(value);
            setSaved(false);
          }}
          disabled={busy || blocked || reloadPending}
        />
        {blocked && (
          <p className="field-hint">
            {t('ui.pufu_relations.save_and_close_the_pufu_editor_before_saving_relations')}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {reloadPending && t('ui.pufu_relations.relations_saved_please_reload_the_pufu')}
            {error}
          </p>
        )}
        {saved && (
          <p className="field-hint" role="status">
            {t('ui.pufu_relations.relations_saved')}
          </p>
        )}
        <div className="form-actions">
          <button className="button primary" disabled={busy || blocked}>
            {busy && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
            {busy
              ? t('ui.app.saving')
              : reloadPending
                ? t('ui.pufu_relations.reload_pufu')
                : t('ui.pufu_relations.save_relations')}
          </button>
        </div>
      </form>
    </details>
  );
}
