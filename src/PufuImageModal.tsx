import { t, useLanguage } from './i18n';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import PufuModal from './PufuModal';
type Point = {
  x: number;
  y: number;
};
type View = Point & {
  scale: number;
};
const initialView: View = { scale: 1, x: 0, y: 0 };
const midpoint = (points: Point[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});
const distance = (points: Point[]) =>
  Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
export default function PufuImageModal({
  image,
  phase,
  onClose,
}: {
  image: {
    __html: string;
  };
  phase: number;
  onClose: () => void;
}) {
  useLanguage();
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const current = useRef(initialView);
  const [view, setView] = useState(initialView);
  function update(next: View) {
    const rect = viewport.current!.getBoundingClientRect();
    const limitX = (rect.width * (next.scale - 1)) / 2;
    const limitY = (rect.height * (next.scale - 1)) / 2;
    current.current = {
      scale: next.scale,
      x: Math.max(-limitX, Math.min(limitX, next.x)),
      y: Math.max(-limitY, Math.min(limitY, next.y)),
    };
    setView(current.current);
  }
  function zoom(scale: number, anchor?: Point) {
    const rect = viewport.current!.getBoundingClientRect();
    const previous = current.current;
    const nextScale = Math.max(1, Math.min(6, scale));
    const ratio = nextScale / previous.scale;
    const x = anchor ? anchor.x - rect.left - rect.width / 2 : 0;
    const y = anchor ? anchor.y - rect.top - rect.height / 2 : 0;
    update({ scale: nextScale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
  }
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(current.current.scale * Math.exp(-event.deltaY * 0.01), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = [...pointers.current.values()].slice(0, 2);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()].slice(0, 2);
    const from = midpoint(before),
      to = midpoint(after);
    const previous = current.current;
    const factor =
      before.length === 2 && distance(before) > 0 ? distance(after) / distance(before) : 1;
    zoom(previous.scale * factor, from);
    update({
      ...current.current,
      x: current.current.x + to.x - from.x,
      y: current.current.y + to.y - from.y,
    });
  }
  const release = (event: PointerEvent<HTMLDivElement>) => pointers.current.delete(event.pointerId);
  return (
    <PufuModal
      title={t('ui.pufu_image_modal.pufu_phase_value', { value0: phase })}
      onClose={onClose}
    >
      <div className="pufu-image-controls">
        <button
          className="icon-button"
          aria-label={t('ui.pufu_image_modal.zoom_out')}
          disabled={view.scale <= 1}
          onClick={() => zoom(view.scale - 0.5)}
        >
          <Minus size={20} aria-hidden="true" />
        </button>
        <output aria-label={t('ui.pufu_image_modal.zoom_level')}>
          {Math.round(view.scale * 100)}%
        </output>
        <button
          className="icon-button"
          aria-label={t('ui.pufu_image_modal.zoom_in')}
          disabled={view.scale >= 6}
          onClick={() => zoom(view.scale + 0.5)}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
        <button
          className="button secondary"
          aria-label={t('ui.pufu_image_modal.fit_to_view')}
          onClick={() => update(initialView)}
        >
          <Maximize2 size={16} aria-hidden="true" />
          {t('ui.pufu_image_modal.fit_to_view')}
        </button>
      </div>
      <div
        ref={viewport}
        className="pufu-image-viewport"
        role="region"
        aria-label={t('ui.pufu_image_modal.enlarged_pufu')}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          const pan: Record<string, Point> = {
            ArrowLeft: { x: 40, y: 0 },
            ArrowRight: { x: -40, y: 0 },
            ArrowUp: { x: 0, y: 40 },
            ArrowDown: { x: 0, y: -40 },
          };
          if (pan[event.key])
            update({
              ...current.current,
              x: current.current.x + pan[event.key].x,
              y: current.current.y + pan[event.key].y,
            });
          else if (event.key === '+' || event.key === '=') zoom(view.scale + 0.5);
          else if (event.key === '-') zoom(view.scale - 0.5);
          else if (event.key === '0') update(initialView);
          else return;
          event.preventDefault();
        }}
      >
        <div
          className="pufu-image-canvas"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <div
            role="img"
            aria-label={t('ui.pufu_image_modal.pufu_phase_value', { value0: phase })}
            dangerouslySetInnerHTML={image}
          />
        </div>
      </div>
      <p className="field-hint pufu-image-help">
        {t('ui.pufu_image_modal.pinch_or_use_and_to_zoom_drag_or_use')}
      </p>
    </PufuModal>
  );
}
