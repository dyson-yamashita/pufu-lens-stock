import { useMemo } from 'react';
import { createPufuSvg } from '@pufu-lens/pufu-image';
import type { PufuScore } from '../shared/pufu';

export default function PufuImagePreview({ score, phase }: { score: PufuScore; phase: number }) {
  const image = useMemo(() => {
    try {
      return { __html: createPufuSvg(score, { showProgress: false }) };
    } catch {
      return null;
    }
  }, [score]);
  return (
    <figure className="pufu-image-preview">
      <figcaption className="field-hint">
        第{phase}局面のプ譜（保存済み）。編集内容は保存後に画像へ反映されます。
      </figcaption>
      {image ? (
        // createPufuSvgは入力の文章・属性をXMLエスケープしてSVGを生成する。
        <div role="img" aria-label={`第${phase}局面のプ譜`} dangerouslySetInnerHTML={image} />
      ) : (
        <p className="field-hint" role="status">
          プ譜の画像を表示できません。下のエディターで内容を確認・編集できます。
        </p>
      )}
    </figure>
  );
}
