import { t, useLanguage } from './i18n';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export default function MemoryKnowledge({
  text,
  children,
}: {
  text: string;
  children?: ReactNode;
}) {
  useLanguage();
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    setExpanded(false);
    const element = paragraph.current;
    if (!element) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      setCanExpand(element.scrollHeight > lineHeight * 3 + 1);
    };
    measure();
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [text]);
  return (
    <>
      <p id={id} ref={paragraph} className={`knowledge-text${expanded ? ' expanded' : ''}`}>
        {text}
      </p>
      <div className="evidence-links">
        {canExpand && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('ui.app.close') : t('ui.memory_knowledge.read_more')}
          </button>
        )}
        {children}
      </div>
    </>
  );
}
