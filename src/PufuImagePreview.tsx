import { useMemo, useState } from 'react';
import { createPufuSvg } from '@pufu-lens/pufu-image';
import type { PufuScore } from '../shared/pufu';
import { Pencil } from 'lucide-react';
import PufuImageModal from './PufuImageModal';
import { useTheme } from './theme';

export default function PufuImagePreview({
  score,
  phase,
  onEdit,
}: {
  score: PufuScore;
  phase: number;
  onEdit: () => void;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const image = useMemo(() => {
    try {
      return { __html: createPufuSvg(score, { showProgress: false, theme }) };
    } catch {
      return null;
    }
  }, [score, theme]);
  return (
    <div className="pufu-image-preview">
      {image ? (
        <button
          className="pufu-image-open"
          aria-label={`第${phase}局面のプ譜を拡大表示`}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setExpanded(true);
          }}
        >
          {/* createPufuSvgは入力の文章・属性をXMLエスケープしてSVGを生成する。 */}
          <span role="img" aria-label={`第${phase}局面のプ譜`} dangerouslySetInnerHTML={image} />
        </button>
      ) : (
        <p className="field-hint" role="status">
          プ譜の画像を表示できません。「編集する」から内容を確認・編集できます。
        </p>
      )}
      <div className="pufu-image-actions">
        <button
          className="button secondary"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onEdit();
          }}
        >
          <Pencil size={16} aria-hidden="true" />
          編集する
        </button>
      </div>
      {expanded && image && (
        <PufuImageModal image={image} phase={phase} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}
