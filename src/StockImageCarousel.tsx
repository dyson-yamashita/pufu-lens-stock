import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t, useLanguage } from './i18n';

export type CarouselImage = { id: string; filename: string; url: string };

export default function StockImageCarousel({ images }: { images: CarouselImage[] }) {
  useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      className="stock-image-carousel"
      aria-label={t('stock_images.title')}
      aria-roledescription={multiple ? t('stock_images.carousel') : undefined}
      onKeyDown={(event) => {
        if (!multiple || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
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
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('stock_images.open', { name: current.filename })}
        >
          <img src={current.url} alt={current.filename} loading="lazy" draggable={false} />
        </a>
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
      <p className="stock-image-caption">{current.filename}</p>
    </section>
  );
}
