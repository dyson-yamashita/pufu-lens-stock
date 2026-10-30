import { Fragment } from 'react';
import { elementKeys, type PufuScore } from '../shared/pufu';
import PufuImagePreview from './PufuImagePreview';

const elementLabels = {
  people: 'ひと',
  money: 'お金',
  time: '時間',
  quality: 'クオリティ',
  businessScheme: '商流 / 座組',
  environment: '環境',
  rival: 'ライバル',
  foreignEnemy: '外敵',
};

export default function PublicPufuScore({ score, phase }: { score: PufuScore; phase: number }) {
  const entries: { label: string; node: PufuScore['gainingGoal'] }[] = [
    { label: '獲得目標', node: score.gainingGoal },
    { label: '勝利条件', node: score.winCondition },
    ...elementKeys.map((key) => ({ label: elementLabels[key], node: score.elements[key] })),
    ...score.purposes.flatMap((purpose, index) => [
      { label: `中間目的 ${index + 1}`, node: purpose },
      ...purpose.measures.map((measure, measureIndex) => ({
        label: `施策 ${index + 1}-${measureIndex + 1}`,
        node: measure,
      })),
    ]),
  ];
  return (
    <>
      <div className="public-pufu-preview" aria-label="プ譜（閲覧のみ）">
        <PufuImagePreview score={score} phase={phase} />
        <section className="public-pufu-text" aria-label={`第${phase}局面のプ譜の内容`}>
          <h3>プ譜の内容</h3>
          <dl>
            {entries.map(({ label, node }) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>
                  <p>{node.text}</p>
                  {node.comment.text && <p>コメント：{node.comment.text}</p>}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      </div>
      <p className="pufu-credit">
        <a href="https://github.com/goto-lab/pufu-editor" target="_blank" rel="noreferrer">
          プ譜エディター
        </a>{' '}
        © 2024 Gotolab ·{' '}
        <a href="/licenses/pufu-editor.txt" target="_blank" rel="noreferrer">
          BSD-3-Clause
        </a>
      </p>
    </>
  );
}
