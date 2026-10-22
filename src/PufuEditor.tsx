import { useEffect, useRef, useState } from 'react';
import { getScoreJson } from '@goto-lab/pufu-editor';
import { Check, Download, LoaderCircle, Plus, Save, Triangle } from 'lucide-react';
import { pufuScoreSchema, type Pufu } from '../shared/pufu';
import { send } from './api';
import { useTheme } from './theme';
import PufuImagePreview from './PufuImagePreview';
import PufuModal from './PufuModal';
import ResponsivePufuScore from './ResponsivePufuScore';

const canonical = (json: string) =>
  JSON.stringify(JSON.parse(json), (key, value) => (key === 'id' ? undefined : value));
const memoryDate = (value: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
export default function PufuEditor({
  pufu,
  onGuard,
}: {
  pufu: Pufu;
  onGuard: (guard: (() => boolean) | null) => void;
}) {
  const { theme } = useTheme();
  const [revision, setRevision] = useState(pufu.revision);
  const [phases, setPhases] = useState(pufu.phases);
  // エディターは入力オブジェクトを直接変更するため、保存済みの局面とは参照を分ける。
  const [editor, setEditor] = useState(() => structuredClone(pufu.phases.at(-1)!));
  const editorKey = `${pufu.id}-phase-${editor.number}`;
  const currentPhase = phases.at(-1)!.number;
  const isLatest = editor.number === currentPhase;
  const feedback = editor.number % 2 === 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const savedPhase = phases.find((phase) => phase.number === editor.number)!;
  const baseline = useRef(canonical(JSON.stringify(editor.score)));
  const hasChanges = () => {
    if (!editing) return false;
    const json = getScoreJson(editorKey);
    return Boolean(json && canonical(json) !== baseline.current);
  };
  useEffect(() => {
    const changed = () => {
      if (!editing) return false;
      const json = getScoreJson(editorKey);
      return Boolean(json && canonical(json) !== baseline.current);
    };
    onGuard(
      () => !changed() || window.confirm('保存していない変更があります。保存せずに移動しますか？'),
    );
    const unload = (event: BeforeUnloadEvent) => {
      if (changed()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    const timer = window.setInterval(() => setDirty(changed()), 700);
    return () => {
      onGuard(null);
      window.removeEventListener('beforeunload', unload);
      window.clearInterval(timer);
    };
  }, [editorKey, onGuard, editing]);
  function openEditor() {
    if (busy) return;
    setEditor(structuredClone(savedPhase));
    baseline.current = canonical(JSON.stringify(savedPhase.score));
    setDirty(false);
    setError('');
    setNotice('');
    setEditing(true);
  }
  function closeEditor() {
    if (busy) return;
    if (hasChanges() && !window.confirm('保存していない変更があります。保存せずに閉じますか？'))
      return;
    setEditing(false);
    setEditor(structuredClone(savedPhase));
    baseline.current = canonical(JSON.stringify(savedPhase.score));
    setDirty(false);
  }
  function selectPhase(number: number) {
    if (number === editor.number || busy) return;
    if (
      hasChanges() &&
      !window.confirm('保存していない変更があります。保存せずに局面を切り替えますか？')
    )
      return;
    const phase = phases.find((phase) => phase.number === number)!;
    baseline.current = canonical(JSON.stringify(phase.score));
    setEditor(structuredClone(phase));
    setDirty(false);
    setError('');
    setNotice('');
  }
  async function save(append = false) {
    if (busy || (append && !isLatest)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const json = editing ? getScoreJson(editorKey) : JSON.stringify(savedPhase.score);
      if (!json) throw new Error('編集内容を読み取れませんでした。');
      const input = pufuScoreSchema.safeParse(JSON.parse(json));
      if (!input.success)
        throw new Error(
          '文章は各1,200文字以内、コメントは600文字以内、中間目的と各施策は12件以内で入力してください。',
        );
      const result = await send<{ revision: number; current_phase: number; updated_at: string }>(
        `/api/v1/pufus/${encodeURIComponent(pufu.id)}${append ? '/phases' : ''}`,
        { revision, phase: editor.number, score: input.data },
        append ? 'POST' : 'PATCH',
      );
      const saved = { ...editor, score: input.data, updated_at: result.updated_at };
      const next = { ...saved, number: result.current_phase, created_at: result.updated_at };
      setPhases((current) => [
        ...current.map((phase) => (phase.number === editor.number ? saved : phase)),
        ...(append ? [next] : []),
      ]);
      baseline.current = canonical(json);
      setRevision(result.revision);
      setDirty(false);
      if (append) setEditor(structuredClone(next));
      setNotice(append ? `第${result.current_phase}局面を追加しました。` : 'プ譜を保存しました。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {pufu.model === 'local-pufu-template' && (
        <p className="pufu-demo-note">
          ローカルデモ：AI未接続のため、問い・課題・メモリから定型の案を作成しています。
        </p>
      )}
      <div className="pufu-phase-bar">
        <div className="pufu-phase-navigation" role="group" aria-label="局面の切り替え">
          {editor.number > 1 && (
            <button
              className="icon-button pufu-phase-previous"
              aria-label="前の局面へ"
              disabled={busy}
              onClick={() => selectPhase(editor.number - 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
          <span className="pufu-phase-number" aria-live="polite">
            第{editor.number}局面
          </span>
          {editor.number < currentPhase && (
            <button
              className="icon-button pufu-phase-next"
              aria-label="次の局面へ"
              disabled={busy}
              onClick={() => selectPhase(editor.number + 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="pufu-toolbar">
        <div>
          <button
            className="button secondary"
            onClick={() => {
              const json = JSON.stringify(savedPhase.score);
              const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `${pufu.id}-phase-${editor.number}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={16} aria-hidden="true" />
            JSON
          </button>
          {isLatest && (
            <button className="button secondary" disabled={busy} onClick={() => save(true)}>
              <Plus size={17} aria-hidden="true" />
              局面を追加
            </button>
          )}
        </div>
      </div>
      {isLatest && (
        <p className="field-hint pufu-phase-help">
          奇数局面は編集、偶数局面はフィードバックです。局面を追加すると、現在の内容を保存して次の局面へ引き継ぎます。
        </p>
      )}
      <PufuImagePreview score={savedPhase.score} phase={editor.number} onEdit={openEditor} />
      {!editing && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!editing && notice && (
        <p className="toast" role="status">
          <Check size={17} aria-hidden="true" />
          {notice}
        </p>
      )}
      {editing && (
        <PufuModal title={`第${editor.number}局面のプ譜を編集`} onClose={closeEditor} busy={busy}>
          <div className="pufu-toolbar">
            <span className="field-hint" role="status">
              {dirty ? '未保存の変更があります' : '保存済み'}
            </span>
            <button className="button primary" disabled={busy} onClick={() => save()}>
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Save size={17} aria-hidden="true" />
              )}
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="toast" role="status">
              <Check size={17} aria-hidden="true" />
              {notice}
            </p>
          )}
          <div className="pufu-editor-shell" inert={busy} aria-busy={busy}>
            <ResponsivePufuScore
              key={editorKey}
              uniqueKey={editorKey}
              initScore={editor.score}
              lang="ja"
              feedback={feedback}
              dark={theme === 'dark'}
            />
          </div>
        </PufuModal>
      )}
      <p className="pufu-memory-caption">
        生成に参照したメモリ：あなた{' '}
        {pufu.context.userMemory
          ? `${memoryDate(pufu.context.userMemory.updated_at)} 時点`
          : '未作成'}{' '}
        ／ プロジェクト{' '}
        {pufu.context.projectMemory
          ? `${memoryDate(pufu.context.projectMemory.updated_at)} 時点`
          : '未作成'}
      </p>
      <p className="pufu-credit">
        <a href="https://github.com/goto-lab/pufu-editor" target="_blank" rel="noreferrer">
          プ譜エディター
        </a>{' '}
        © 2024 Gotolab ·{' '}
        <a href="/licenses/pufu-editor.txt" target="_blank" rel="noreferrer">
          BSD-3-Clause
        </a>
      </p>
    </>
  );
}
