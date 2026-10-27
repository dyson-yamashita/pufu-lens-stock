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
  const [questionDraft, setQuestions] = useState<RelationOption[]>();
  const [stockDraft, setStocks] = useState<RelationOption[]>();
  const questions =
    questionDraft ??
    (pufu.questions
      ? pufu.questions.map((question) => ({ id: question.id, label: question.text }))
      : pufu.question_id
        ? [{ id: pufu.question_id, label: pufu.context.question?.text ?? '関連する問い・気づき' }]
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
      const result = await api<{ pufu: Pufu }>(`/api/v1/pufus/${encodeURIComponent(pufu.id)}`);
      onSaved(result.pufu);
      awaitingReload = false;
      setReloadPending(false);
      setQuestions(undefined);
      setStocks(undefined);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(awaitingReload);
    }
  }
  return (
    <details className="pufu-relations">
      <summary>問い・気づきとストックの関連を編集</summary>
      <form onSubmit={save}>
        <p className="field-hint">
          同じプロジェクトの問い・気づきとストックを複数選べます。関連を変えても、保存済みのプ譜や生成時の参照内容は変わりません。
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
          <p className="field-hint">プ譜の編集を保存して閉じてから、関連を保存してください。</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {reloadPending && '関連は保存されました。プ譜を再読み込みしてください。'}
            {error}
          </p>
        )}
        {saved && (
          <p className="field-hint" role="status">
            関連を保存しました。
          </p>
        )}
        <div className="form-actions">
          <button className="button primary" disabled={busy || blocked}>
            {busy && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
            {busy ? '保存中…' : reloadPending ? 'プ譜を再読み込み' : '関連を保存'}
          </button>
        </div>
      </form>
    </details>
  );
}
