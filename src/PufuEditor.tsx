import { useEffect, useRef, useState } from 'react';
import { ProjectScore, getScoreJson } from '@goto-lab/pufu-editor';
import { Check, Download, LoaderCircle, Save } from 'lucide-react';
import { pufuScoreSchema, type Pufu } from '../shared/pufu';
import { send } from './api';

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
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [revision, setRevision] = useState(pufu.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const baseline = useRef(canonical(JSON.stringify(pufu.score)));
  const hasChanges = () => {
    const json = getScoreJson(pufu.id);
    return Boolean(json && canonical(json) !== baseline.current);
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const changed = () => {
      const json = getScoreJson(pufu.id);
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
  }, [pufu.id, onGuard]);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const json = getScoreJson(pufu.id);
      if (!json) throw new Error('編集内容を読み取れませんでした。');
      const input = pufuScoreSchema.safeParse(JSON.parse(json));
      if (!input.success)
        throw new Error(
          '文章は各1,200文字以内、コメントは600文字以内、中間目的と各施策は12件以内で入力してください。',
        );
      const result = await send<{ revision: number }>(
        `/api/v1/pufus/${encodeURIComponent(pufu.id)}`,
        { revision, score: input.data },
        'PATCH',
      );
      baseline.current = canonical(json);
      setRevision(result.revision);
      setDirty(hasChanges());
      setNotice('プ譜を保存しました。');
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
      <div className="pufu-toolbar">
        <span className="field-hint" role="status">
          {dirty ? '未保存の変更があります' : '保存済み'}
        </span>
        <div>
          <button
            className="button secondary"
            onClick={() => {
              const json = getScoreJson(pufu.id);
              if (!json) return;
              const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `${pufu.id}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={16} aria-hidden="true" />
            JSON
          </button>
          <button className="button primary" disabled={busy} onClick={save}>
            {busy ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <Save size={17} aria-hidden="true" />
            )}
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
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
      <div className="pufu-editor-shell">
        <div className="pufu-editor-root">
          <ProjectScore
            uniqueKey={pufu.id}
            initScore={pufu.score!}
            lang="ja"
            mobile={mobile}
            textSize="base"
            feedback
            border={!mobile}
          />
        </div>
      </div>
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
