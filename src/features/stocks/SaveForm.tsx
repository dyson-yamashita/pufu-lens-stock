import { Bookmark, ChevronDown } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../../shared/domain';
import { stockInputSchema, stockTextLimit } from '../../../shared/domain';
import { stockImageLimit, stockImageTypes } from '../../../shared/stock-images';
import { isYouTubeUrl } from '../../../shared/youtube';
import { FormError } from '../../components/FormError';
import { Spinner } from '../../components/Spinner';
import { applicationError, intlLocale, t, useLanguage } from '../../i18n/i18n';
import { api, ApiError, createRequestId } from '../../lib/api';
import { stockImageFileError, uploadStockImage } from './stock-image-upload';
import type { SavedStock } from './types';

export function SaveForm({
  projects,
  projectId,
  onDone,
}: {
  projects: Project[];
  projectId: string | null;
  onDone: (duplicate: boolean, youtube: boolean, stock: SavedStock) => void;
}) {
  useLanguage();
  const [type, setType] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState(projectId ?? projects[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(createRequestId());
  const [images, setImages] = useState<{ file: File; requestId: string }[]>([]);
  const [saved, setSaved] = useState<{
    duplicate: boolean;
    youtube: boolean;
    stock: SavedStock;
  } | null>(null);
  async function attachImages(result: NonNullable<typeof saved>) {
    setBusy(true);
    setError('');
    try {
      for (const image of images) {
        await uploadStockImage(result.stock.id, image.file, image.requestId);
        setImages((current) => current.filter((item) => item.requestId !== image.requestId));
      }
      onDone(result.duplicate, result.youtube, result.stock);
    } catch (e) {
      setError(t('stock_images.partial_save') + ' ' + applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <div>
        <p role="status">{busy ? t('stock_images.processing') : t('stock_images.stock_saved')}</p>
        <FormError error={error} />
        <div className="form-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => onDone(saved.duplicate, saved.youtube, saved.stock)}
          >
            {t('stock_images.finish_without_remaining')}
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void attachImages(saved)}
          >
            {t('stock_images.retry_upload')}
          </button>
        </div>
      </div>
    );
  return (
    <form
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const payload =
          type === 'url'
            ? {
                type,
                project_id: target,
                url,
                note,
              }
            : { type: 'text', project_id: target, title, text, note };
        const parsed = stockInputSchema.safeParse(payload);
        if (!parsed.success) {
          setError(
            type !== 'url' && !text.trim()
              ? t('ui.app.enter_the_article_text')
              : t('ui.app.check_your_input_the_length_or_format_is_incorrect'),
          );
          document.getElementById(type !== 'url' ? 'stock-text' : 'stock-url')?.focus();
          return;
        }
        setBusy(true);
        try {
          const result = await api<{
            id: string;
            duplicate: boolean;
          }>('/api/v1/stocks', {
            method: 'POST',
            headers: { 'Idempotency-Key': key.current },
            body: JSON.stringify(parsed.data),
          });
          const savedStock = {
            duplicate: result.duplicate,
            youtube: parsed.data.type === 'url' && isYouTubeUrl(parsed.data.url),
            stock: {
              id: result.id,
              projectId: target,
              label: title.trim() || (type === 'url' ? url : text.slice(0, 80)),
            },
          };
          if (images.length) {
            setSaved(savedStock);
            await attachImages(savedStock);
          } else onDone(savedStock.duplicate, savedStock.youtube, savedStock.stock);
        } catch (e) {
          setError(applicationError((e as Error).message));
          if ((e as ApiError).status === 409) key.current = createRequestId();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">
        {t('ui.app.saving_a_url_or_text_generates_a_summary_and')}
        {projects.find((project) => project.id === target)?.auto_generate_questions !== false &&
          t('ui.app.questions_and_insights_are_also_generated_automatically')}
      </p>
      <div
        className="stock-source-tabs"
        role="tablist"
        aria-label={t('ui.app.type')}
        onKeyDown={(event) => {
          if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextType =
            event.key === 'Home'
              ? 'url'
              : event.key === 'End'
                ? 'text'
                : type === 'url'
                  ? 'text'
                  : 'url';
          setType(nextType);
          setError('');
          key.current = createRequestId();
          document.getElementById(`stock-source-tab-${nextType}`)?.focus();
        }}
      >
        {(
          [
            ['url', 'URL'],
            ['text', t('ui.app.text')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`stock-source-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={type === value}
            aria-controls="stock-source-panel"
            tabIndex={type === value ? 0 : -1}
            autoFocus={value === 'url'}
            disabled={busy}
            onClick={() => {
              setType(value);
              setError('');
              key.current = createRequestId();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="stock-source-panel" role="tabpanel" aria-labelledby={`stock-source-tab-${type}`}>
        <label htmlFor="stock-project">{t('ui.app.destination_project')}</label>
        <select
          id="stock-project"
          value={target}
          disabled={busy || !projects.length}
          onChange={(e) => {
            setTarget(e.target.value);
            key.current = createRequestId();
          }}
        >
          {!target && <option value="">{t('ui.app.select_a_project')}</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {type === 'url' ? (
          <>
            <label htmlFor="stock-url">{t('ui.app.post_url')}</label>
            <input
              id="stock-url"
              type="url"
              value={url}
              disabled={busy}
              onChange={(e) => {
                setUrl(e.target.value);
                key.current = createRequestId();
              }}
              required
              maxLength={4096}
              placeholder="https://…"
            />
            <p className="profile-hint">
              {t('ui.app.to_retrieve_x_posts_register_a_bearer_token_in')}
            </p>
          </>
        ) : (
          <>
            <label htmlFor="stock-text">{t('ui.app.content')}</label>
            <textarea
              id="stock-text"
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
                key.current = createRequestId();
              }}
              required
              maxLength={stockTextLimit}
              rows={6}
              aria-describedby="stock-text-hint"
              placeholder={t('ui.app.enter_or_paste_the_text_you_want_to_save')}
            />
            <p id="stock-text-hint" className="profile-hint profile-bio-hint">
              <span>{t('ui.app.up_to_20_000_characters')}</span>
              <span>{text.length.toLocaleString(intlLocale())} / 20,000</span>
            </p>
          </>
        )}
        <details className="stock-details">
          <summary>
            {t('ui.app.details')}
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {type === 'text' && (
            <>
              <label htmlFor="stock-text-title">
                {t('ui.app.title')}
                <span className="optional">{t('ui.app.optional')}</span>
              </label>
              <input
                id="stock-text-title"
                value={title}
                disabled={busy}
                onChange={(e) => {
                  setTitle(e.target.value);
                  key.current = createRequestId();
                }}
                maxLength={200}
                placeholder={t('ui.app.if_empty_the_first_line_of_the_text_is')}
              />
            </>
          )}
          <label htmlFor="stock-note">
            {t('ui.app.note')}
            <span className="optional">{t('ui.app.optional')}</span>
          </label>
          <textarea
            id="stock-note"
            value={note}
            disabled={busy}
            onChange={(e) => {
              setNote(e.target.value);
              key.current = createRequestId();
            }}
            maxLength={2000}
            rows={3}
            placeholder={t('ui.app.why_it_caught_your_attention_or_what_you_want')}
          />
        </details>
      </div>
      <label htmlFor="new-stock-images">{t('stock_images.attach')}</label>
      <p id="new-stock-images-hint" className="local-model-note">
        {t('stock_images.hint')}
      </p>
      <input
        id="new-stock-images"
        type="file"
        multiple
        accept={stockImageTypes.join(',')}
        disabled={busy}
        aria-describedby="new-stock-images-hint"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          const validationError =
            files.length > stockImageLimit
              ? t('stock_images.limit_reached')
              : files.map(stockImageFileError).find(Boolean);
          if (validationError) {
            setError(validationError);
            setImages([]);
            event.currentTarget.value = '';
            return;
          }
          setError('');
          setImages(files.map((file) => ({ file, requestId: createRequestId() })));
        }}
      />
      {images.length > 0 && (
        <ul>
          {images.map((image) => (
            <li key={image.requestId}>{image.file.name}</li>
          ))}
        </ul>
      )}
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy || !target}>
          {busy ? <Spinner /> : <Bookmark size={17} aria-hidden="true" />}
          {busy ? t('ui.app.saving') : t('ui.app.save_stock')}
        </button>
      </div>
    </form>
  );
}
