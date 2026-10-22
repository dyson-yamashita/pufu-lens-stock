import { useId, useState } from 'react';
import type { PufuScore } from '../shared/pufu';
import { useTheme } from './theme';
import ResponsivePufuScore from './ResponsivePufuScore';

export default function PublicPufuScore({ score }: { score: PufuScore }) {
  const id = useId();
  const { theme } = useTheme();
  // エディター内部のストアとAPIから取得した公開データの参照を分ける。
  const [initialScore] = useState(() => structuredClone(score));
  return (
    <>
      <div className="pufu-editor-shell public-pufu-preview" aria-label="プ譜（閲覧のみ）">
        <ResponsivePufuScore
          uniqueKey={`public-${id}`}
          initScore={initialScore}
          preview
          showProgress
          lang="ja"
          dark={theme === 'dark'}
        />
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
