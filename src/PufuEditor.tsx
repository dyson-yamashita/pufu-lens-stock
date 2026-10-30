import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { languages } from '../shared/locale';
import { useEffect, useRef, useState } from 'react';
import { getScoreJson } from '@goto-lab/pufu-editor';
import { Check, Download, LoaderCircle, Plus, Save, Triangle } from 'lucide-react';
import { pufuScoreSchema, type Pufu } from '../shared/pufu';
import { send } from './api';
import { useTheme } from './theme';
import PufuImagePreview from './PufuImagePreview';
import PufuModal from './PufuModal';
import ResponsivePufuScore from './ResponsivePufuScore';
import Comments from './Comments';
const canonical = (json: string) =>
  JSON.stringify(JSON.parse(json), (key, value) => (key === 'id' ? undefined : value));
const memoryDate = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
export default function PufuEditor({
  pufu,
  onGuard,
  onEditingStateChange,
  onSaved,
}: {
  pufu: Pufu;
  onGuard: (guard: (() => boolean) | null) => void;
  onEditingStateChange?: (blocked: boolean) => void;
  onSaved?: (revision: number) => void;
}) {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const [revision, setRevision] = useState(pufu.revision);
  const [phases, setPhases] = useState(pufu.phases);
  // エディターは入力オブジェクトを直接変更するため、保存済みの局面とは参照を分ける。
  const [editor, setEditor] = useState(() => structuredClone(pufu.phases.at(-1)!));
  const editorKey = `${pufu.id}-phase-${editor.number}`;
  const currentPhase = phases.at(-1)!.number;
  const isLatest = editor.number === currentPhase;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  useEffect(() => {
    onEditingStateChange?.(editing || busy);
    return () => onEditingStateChange?.(false);
  }, [editing, busy, onEditingStateChange]);
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
      () =>
        !changed() ||
        window.confirm(t('ui.pufu_editor.you_have_unsaved_changes_leave_without_saving')),
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
    if (
      hasChanges() &&
      !window.confirm(t('ui.pufu_editor.you_have_unsaved_changes_close_without_saving'))
    )
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
      !window.confirm(t('ui.pufu_editor.you_have_unsaved_changes_switch_phases_without_saving'))
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
      if (!json) throw new Error(t('ui.pufu_editor.could_not_read_the_edited_content'));
      const input = pufuScoreSchema.safeParse(JSON.parse(json));
      if (!input.success)
        throw new Error(t('ui.pufu_editor.keep_each_text_within_1_200_characters_each_comment'));
      const result = await send<{
        revision: number;
        current_phase: number;
        updated_at: string;
      }>(
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
      onSaved?.(result.revision);
      setDirty(false);
      if (append) setEditor(structuredClone(next));
      setNotice(
        append
          ? t('ui.pufu_editor.phase_value_added', { value0: result.current_phase })
          : t('ui.pufu_editor.pufu_saved'),
      );
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function download(format: 'json' | 'png') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob =
        format === 'json'
          ? new Blob([JSON.stringify(savedPhase.score)], { type: 'application/json' })
          : await (
              await import('./pufu-download')
            ).createPufuPng(savedPhase.score, theme, language);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${pufu.id}-phase-${editor.number}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadOpen(false);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {pufu.model === 'local-pufu-template' && (
        <p className="pufu-demo-note">
          {t('ui.pufu_editor.local_demo_without_ai_a_template_proposal_is_created')}
        </p>
      )}
      <div className="pufu-phase-bar">
        <div
          className="pufu-phase-navigation"
          role="group"
          aria-label={t('ui.pufu_editor.switch_phase')}
        >
          {editor.number > 1 && (
            <button
              className="icon-button pufu-phase-previous"
              aria-label={t('ui.pufu_editor.previous_phase')}
              disabled={busy}
              onClick={() => selectPhase(editor.number - 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
          <span className="pufu-phase-number" aria-live="polite">
            {t('phase.number', { number: editor.number })}
          </span>
          {editor.number < currentPhase && (
            <button
              className="icon-button pufu-phase-next"
              aria-label={t('ui.pufu_editor.next_phase')}
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
            disabled={busy}
            onClick={() => {
              setError('');
              setDownloadOpen(true);
            }}
          >
            <Download size={16} aria-hidden="true" />
            {t('ui.pufu_editor.download')}
          </button>
          {isLatest && (
            <button className="button secondary" disabled={busy} onClick={() => save(true)}>
              <Plus size={17} aria-hidden="true" />
              {t('ui.pufu_editor.add_phase')}
            </button>
          )}
        </div>
      </div>
      {isLatest && (
        <p className="field-hint pufu-phase-help">
          {t('ui.pufu_editor.you_can_edit_text_and_comments_in_every_phase')}
        </p>
      )}
      <PufuImagePreview score={savedPhase.score} phase={editor.number} onEdit={openEditor} />
      <Comments targetType="pufu" targetId={pufu.id} phase={editor.number} />
      {!editing && !downloadOpen && error && (
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
      {downloadOpen && (
        <PufuModal
          title={t('ui.pufu_editor.choose_download_format')}
          wide={false}
          busy={busy}
          onClose={() => setDownloadOpen(false)}
        >
          <div className="pufu-download-options" aria-busy={busy}>
            <button className="button secondary" disabled={busy} onClick={() => download('json')}>
              JSON
            </button>
            <button className="button secondary" disabled={busy} onClick={() => download('png')}>
              {t('ui.pufu_editor.image_png')}
            </button>
          </div>
          {busy && (
            <p className="content-loading" role="status">
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
              {t('ui.pufu_editor.preparing_download')}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </PufuModal>
      )}
      {editing && (
        <PufuModal
          title={t('ui.pufu_editor.edit_pufu_phase_value', { value0: editor.number })}
          onClose={closeEditor}
          busy={busy}
        >
          <div className="pufu-toolbar">
            <span className="field-hint" role="status">
              {dirty ? t('ui.pufu_editor.unsaved_changes') : t('ui.pufu_editor.saved')}
            </span>
            <button className="button primary" disabled={busy} onClick={() => save()}>
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Save size={17} aria-hidden="true" />
              )}
              {busy ? t('ui.app.saving') : t('ui.app.save')}
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
              lang={languages[language].editorLanguage}
              feedback
              dark={theme === 'dark'}
            />
          </div>
        </PufuModal>
      )}
      <p className="pufu-memory-caption">
        {t('ui.pufu_editor.memory_used_for_generation_you')}{' '}
        {pufu.context.userMemory
          ? t('ui.pufu_editor.as_of_value', {
              value0: memoryDate(pufu.context.userMemory.updated_at),
            })
          : t('ui.pufu_editor.not_created')}{' '}
        {t('ui.pufu_editor.project')}{' '}
        {pufu.context.projectMemory
          ? t('ui.pufu_editor.as_of_value', {
              value0: memoryDate(pufu.context.projectMemory.updated_at),
            })
          : t('ui.pufu_editor.not_created')}
      </p>
      <p className="pufu-credit">
        <a href="https://github.com/goto-lab/pufu-editor" target="_blank" rel="noreferrer">
          {t('ui.public_pufu_score.pufu_editor')}
        </a>{' '}
        © 2024 Gotolab ·{' '}
        <a href="/licenses/pufu-editor.txt" target="_blank" rel="noreferrer">
          BSD-3-Clause
        </a>
      </p>
    </>
  );
}
