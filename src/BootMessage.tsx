import { useEffect, useMemo, useState } from 'react';
import { useLanguage, translateUi } from './i18n';
import type { Language } from '../shared/locale';

const waitingDelay = 4000;
type Frame = { text: string; delay: number | null; composition?: string; converted?: boolean };
function makeFrames(language: Language): Frame[] {
  const initialMessage = translateUi(language, 'boot.initial');
  const waitingMessage = translateUi(language, 'boot.waiting');
  const result: Frame[] = [{ text: initialMessage, delay: waitingDelay }];
  for (let length = initialMessage.length - 1; length >= 0; length--)
    result.push({ text: initialMessage.slice(0, length), delay: length ? 55 : 200 });
  if (language !== 'ja') {
    for (let length = 1; length <= waitingMessage.length; length++)
      result.push({ text: waitingMessage.slice(0, length), delay: 55 });
    result.push({ text: waitingMessage, delay: null });
    return result;
  }
  let text = '';
  for (const part of [
    { kana: 'たなのじゅんび', converted: '棚の準備' },
    { kana: 'にじかんが', converted: 'に時間が' },
    { kana: 'かかっています。\n', converted: 'かかっています。\n' },
    { kana: 'しばらくおまちください', converted: 'しばらくお待ちください' },
  ]) {
    for (let length = 1; length <= part.kana.length; length++)
      result.push({ text, composition: part.kana.slice(0, length), delay: 90 });
    result.push({ text, composition: part.converted, converted: true, delay: 300 });
    text += part.converted;
  }
  result.push({ text: waitingMessage, delay: null });
  return result;
}

export function BootMessage() {
  const { language } = useLanguage();
  const initialMessage = translateUi(language, 'boot.initial');
  const waitingMessage = translateUi(language, 'boot.waiting');
  const frames = useMemo(() => makeFrames(language), [language]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let next = 0;
    const schedule = () => {
      clearTimeout(timer);
      const delay = frames[next].delay;
      if (delay === null) return;
      if (reducedMotion.matches) {
        if (next > 0) {
          next = frames.length - 1;
          setIndex(next);
          return;
        }
        timer = setTimeout(
          () => {
            next = frames.length - 1;
            setIndex(next);
          },
          Math.max(0, waitingDelay - (Date.now() - startedAt)),
        );
        return;
      }
      timer = setTimeout(
        () => {
          next++;
          setIndex(next);
          schedule();
        },
        next === 0 ? Math.max(0, waitingDelay - (Date.now() - startedAt)) : delay,
      );
    };
    schedule();
    reducedMotion.addEventListener('change', schedule);
    return () => {
      clearTimeout(timer);
      reducedMotion.removeEventListener('change', schedule);
    };
  }, [frames]);
  const frame = frames[index] ?? frames[0];
  return (
    <p className="boot-status" role="status">
      <span className="boot-message-label">{index === 0 ? initialMessage : waitingMessage}</span>
      <span className="boot-message-space" aria-hidden="true">
        {waitingMessage}
      </span>
      <span className="boot-message-typing" aria-hidden="true">
        {frame.text}
        <span className={frame.converted ? 'boot-converted' : 'boot-composing'}>
          {frame.composition}
        </span>
        {index > 0 && index < frames.length - 1 && <span className="boot-caret" />}
      </span>
    </p>
  );
}
