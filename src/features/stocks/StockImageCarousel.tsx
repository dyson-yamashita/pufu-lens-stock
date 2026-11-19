import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { t, useLanguage } from '../../i18n/i18n';
import StockImageDialog from './StockImageDialog';

export type CarouselImage = { id: string; filename: string; url: string };

export default function StockImageCarousel({
  images,
  preview,
}: {
  images: CarouselImage[];
  preview?: { onOpen: () => void; openLabel: string };
}) {
  useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  if (!images.length) return null;
  const selected = Math.max(
    0,
    images.findIndex((image) => image.id === selectedId),
  );
  const current = images[selected];
  const multiple = images.length > 1;
  const move = (offset: number) =>
    setSelectedId(images[(selected + offset + images.length) % images.length].id);
  return (
    <section
      className={preview ? 'stock-image-carousel article-image-previews' : 'stock-image-carousel'}
      role={preview ? 'group' : undefined}
      aria-label={t('stock_images.title')}
      aria-roledescription={multiple ? t('stock_images.carousel') : undefined}
      onKeyDown={(event) => {
        if (
          expanded ||
          !multiple ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div
        className="stock-image-slide"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          gesture.current =
            event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchCancel={() => {
          gesture.current = null;
        }}
        onTouchEnd={(event) => {
          const start = gesture.current;
          gesture.current = null;
          const touch = event.changedTouches[0];
          if (!multiple || !start || !touch || event.touches.length) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            event.preventDefault();
            move(dx < 0 ? 1 : -1);
          }
        }}
      >
        <button
          type="button"
          className={preview ? undefined : 'stock-image-open'}
          aria-label={preview?.openLabel ?? t('stock_images.enlarge', { name: current.filename })}
          aria-description={preview ? current.filename : undefined}
          aria-haspopup={preview ? undefined : 'dialog'}
          onClick={(event) => {
            if (preview) {
              preview.onOpen();
              return;
            }
            event.currentTarget.focus({ preventScroll: true });
            setExpanded(true);
          }}
        >
          <img
            src={current.url}
            alt={current.filename}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </button>
      </div>
      {multiple && (
        <div className="stock-image-controls">
          <button
            type="button"
            className="icon-button"
            aria-label={t('stock_images.previous')}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span
            className="stock-image-position"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {selected + 1} / {images.length}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('stock_images.next')}
            onClick={() => move(1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      {!preview && <p className="stock-image-caption">{current.filename}</p>}
      {expanded && !preview && (
        <StockImageDialog image={current} onClose={() => setExpanded(false)} />
      )}
    </section>
  );
}
