import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function ScrollHeader({
  children,
  autoHide,
}: {
  children: ReactNode;
  autoHide: boolean;
}) {
  const header = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (!autoHide) return;
    // iOSのページ上下でのバウンドを、逆向きのスクロールとして扱わない。
    const scrollY = () =>
      Math.max(
        0,
        Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight),
      );
    let previousY = scrollY();
    let direction = 0;
    let distance = 0;
    let navigationFrame: number | null = null;
    const reset = () => {
      previousY = scrollY();
      direction = 0;
      distance = 0;
      setHidden(false);
    };
    const onNavigation = () => {
      reset();
      if (navigationFrame !== null) window.cancelAnimationFrame(navigationFrame);
      // 問い一覧へ戻る際の、次フレームでのスクロール復元を方向判定から除外する。
      navigationFrame = window.requestAnimationFrame(() => {
        navigationFrame = window.requestAnimationFrame(() => {
          navigationFrame = null;
          reset();
        });
      });
    };
    const onScroll = () => {
      const y = scrollY();
      const delta = y - previousY;
      previousY = y;
      if (navigationFrame !== null) return;
      if (y <= (header.current?.offsetHeight ?? 0)) {
        reset();
        return;
      }
      if (!delta) return;
      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta);
      direction = nextDirection;
      // 小さな揺れを無視しつつ、ゆっくりしたスクロールも累積して判定する。
      if (distance >= 8) {
        setHidden(delta > 0);
        distance = 0;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onNavigation);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onNavigation);
      if (navigationFrame !== null) window.cancelAnimationFrame(navigationFrame);
    };
  }, [autoHide]);

  return (
    <div
      ref={header}
      className={`topbar${autoHide && hidden ? ' is-hidden' : ''}`}
      onFocusCapture={() => setHidden(false)}
    >
      {children}
    </div>
  );
}
