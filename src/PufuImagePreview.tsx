import { t, useLanguage } from './i18n';
import { pufuImageLabels } from '../shared/pufu-image-labels';
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
  onEdit?: () => void;
}) {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const image = useMemo(() => {
    try {
      return {
        __html: createPufuSvg(score, {
          showProgress: false,
          theme,
          labels: pufuImageLabels(language),
          language,
        }),
      };
    } catch {
      return null;
    }
  }, [score, theme, language]);
  return (
    <div className="pufu-image-preview">
      {image ? (
        <button
          className="pufu-image-open"
          aria-label={t('ui.pufu_image_preview.enlarge_pufu_phase_value', { value0: phase })}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setExpanded(true);
          }}
        >
          {/* createPufuSvgは入力の文章・属性をXMLエスケープしてSVGを生成する。 */}
          <span
            role="img"
            aria-label={t('ui.pufu_image_modal.pufu_phase_value', { value0: phase })}
            dangerouslySetInnerHTML={image}
          />
        </button>
      ) : (
        <p className="field-hint" role="status">
          {t('ui.pufu_image_preview.cannot_display_the_pufu_image')}
          {onEdit
            ? t('ui.pufu_image_preview.use_edit_to_review_and_edit_its_content')
            : t('ui.pufu_image_preview.the_publisher_needs_to_review_its_content')}
        </p>
      )}
      {onEdit && (
        <div className="pufu-image-actions">
          <button
            className="button secondary"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onEdit();
            }}
          >
            <Pencil size={16} aria-hidden="true" />
            {t('ui.pufu_image_preview.edit')}
          </button>
        </div>
      )}
      {expanded && image && (
        <PufuImageModal image={image} phase={phase} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}
