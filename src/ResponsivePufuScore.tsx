import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { ProjectScore } from '@goto-lab/pufu-editor';

type Props = Omit<ComponentProps<typeof ProjectScore>, 'textSize' | 'mobile' | 'width'>;

export default function ResponsivePufuScore(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const container = ref.current!;
    // pufu-editorのミニマップと同じく、埋め込み先が900px未満なら切り替える。
    const measure = () => setNarrow(container.clientWidth < 900);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="pufu-editor-root" ref={ref}>
      <ProjectScore {...props} textSize={narrow ? 'xsmall' : 'base'} />
    </div>
  );
}
