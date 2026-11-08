import { useEffect, useId, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { api, createRequestId } from './api';
import { stockImageFileError, uploadStockImage } from './stock-image-upload';
import { applicationError, t, useLanguage } from './i18n';
import { stockImageLimit, stockImageTypes, type StockImage } from '../shared/stock-images';
import StockImageCarousel from './StockImageCarousel';

export default function StockImages({
  stockId,
  view = 'manage',
}: {
  stockId: string;
  view?: 'manage' | 'summary';
}) {
  useLanguage();
  const [images, setImages] = useState<StockImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const inputId = useId();
  const hintId = useId();
  const base = `/api/v1/stocks/${encodeURIComponent(stockId)}/images`;
  useEffect(() => {
    let active = true;
    void api<{ images: StockImage[] }>(base)
      .then((result) => {
        if (active) setImages(result.images);
      })
      .catch((e) => {
        if (active) setError(applicationError((e as Error).message));
      });
    return () => {
      active = false;
    };
  }, [base, revision]);
  if (view === 'summary')
    return images ? (
      <StockImageCarousel
        images={images.map((image) => ({
          ...image,
          url: `${base}/${encodeURIComponent(image.id)}`,
        }))}
      />
    ) : error ? (
      <div className="stock-image-load-error">
        <p role="alert">{t('stock_images.load_error')}</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError('');
            setRevision((current) => current + 1);
          }}
        >
          {t('stock_images.retry')}
        </button>
      </div>
    ) : null;
  return (
    <section className="stock-images" aria-label={t('stock_images.title')} aria-busy={busy}>
      <p id={hintId} className="local-model-note">
        {t('stock_images.hint')}
      </p>
      {images === null ? (
        error ? (
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setRevision(revision + 1);
            }}
          >
            {t('stock_images.retry')}
          </button>
        ) : (
          <p role="status">{t('stock_images.loading')}</p>
        )
      ) : (
        <>
          <label htmlFor={inputId}>{t('stock_images.attach')}</label>
          <input
            id={inputId}
            type="file"
            accept={stockImageTypes.join(',')}
            aria-describedby={hintId}
            disabled={busy || images.length >= stockImageLimit}
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setError('');
              const validationError = stockImageFileError(file);
              if (validationError) {
                setError(validationError);
                input.value = '';
                return;
              }
              setBusy(true);
              try {
                const { image } = await uploadStockImage(stockId, file, createRequestId());
                setImages((current) => [...(current ?? []), image]);
              } catch (e) {
                setError(applicationError((e as Error).message));
              } finally {
                input.value = '';
                setBusy(false);
              }
            }}
          />
          {busy && (
            <p role="status">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />{' '}
              {t('stock_images.processing')}
            </p>
          )}
          {images.length === 0 && <p>{t('stock_images.empty')}</p>}
          <ul className="stock-image-list">
            {images.map((image) => (
              <li key={image.id}>
                <a
                  href={`${base}/${encodeURIComponent(image.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('stock_images.open', { name: image.filename })}
                >
                  <img
                    src={`${base}/${encodeURIComponent(image.id)}`}
                    alt={image.filename}
                    loading="lazy"
                  />
                </a>
                <span className="stock-image-name">{image.filename}</span>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  aria-label={t('stock_images.delete_named', { name: image.filename })}
                  onClick={async () => {
                    if (!window.confirm(t('stock_images.confirm_delete', { name: image.filename })))
                      return;
                    setBusy(true);
                    setError('');
                    try {
                      await api(`${base}/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
                      setImages((current) => current!.filter((item) => item.id !== image.id));
                    } catch (e) {
                      setError(applicationError((e as Error).message));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {t('stock_images.delete')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
