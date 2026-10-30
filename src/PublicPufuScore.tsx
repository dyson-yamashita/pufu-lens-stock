import { t, useLanguage } from './i18n';
import { Fragment } from 'react';
import { elementKeys, type PufuScore } from '../shared/pufu';
import PufuImagePreview from './PufuImagePreview';
const elementLabels = () => ({
  people: t('ui.public_pufu_score.people'),
  money: t('ui.public_pufu_score.money'),
  time: t('ui.public_pufu_score.time'),
  quality: t('ui.public_pufu_score.quality'),
  businessScheme: t('ui.public_pufu_score.business_scheme'),
  environment: t('ui.public_pufu_score.environment'),
  rival: t('ui.public_pufu_score.rival'),
  foreignEnemy: t('ui.public_pufu_score.external_threats'),
});
export default function PublicPufuScore({ score, phase }: { score: PufuScore; phase: number }) {
  useLanguage();
  const entries: {
    label: string;
    node: PufuScore['gainingGoal'];
  }[] = [
    { label: t('ui.public_pufu_score.gaining_goal'), node: score.gainingGoal },
    { label: t('ui.public_pufu_score.win_condition'), node: score.winCondition },
    ...elementKeys.map((key) => ({ label: elementLabels()[key], node: score.elements[key] })),
    ...score.purposes.flatMap((purpose, index) => [
      {
        label: t('ui.public_pufu_score.intermediate_purpose_value', { value0: index + 1 }),
        node: purpose,
      },
      ...purpose.measures.map((measure, measureIndex) => ({
        label: t('ui.public_pufu_score.measure_value_value', {
          value0: index + 1,
          value1: measureIndex + 1,
        }),
        node: measure,
      })),
    ]),
  ];
  return (
    <>
      <div className="public-pufu-preview" aria-label={t('ui.public_pufu_score.pufu_read_only')}>
        <PufuImagePreview score={score} phase={phase} />
        <section
          className="public-pufu-text"
          aria-label={t('ui.public_pufu_score.pufu_content_for_phase_value', { value0: phase })}
        >
          <h3>{t('ui.public_pufu_score.pufu_content')}</h3>
          <dl>
            {entries.map(({ label, node }) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>
                  <p>{node.text}</p>
                  {node.comment.text && (
                    <p>
                      {t('ui.public_pufu_score.comment')}
                      {node.comment.text}
                    </p>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      </div>
      <p className="pufu-credit">
        <a href="https://github.com/goto-lab/pufu-editor" target="_blank" rel="noreferrer">
          {t('ui.public_pufu_score.pufu_editor')}
        </a>{' '}
        © 2024 Gotolab ·{' '}
        <a href="/licenses/pufu-editor.txt" target="_blank" rel="noreferrer">
          BSD-3-Clause
        </a>
      </p>
    </>
  );
}
