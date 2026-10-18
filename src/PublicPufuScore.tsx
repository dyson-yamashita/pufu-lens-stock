import { useEffect, useId, useState } from 'react';
import { ProjectScore } from '@goto-lab/pufu-editor';
import type { PufuScore } from '../shared/pufu';
import { useTheme } from './theme';

export default function PublicPufuScore({ score }: { score: PufuScore }) {
  const id = useId();
  const { theme } = useTheme();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  // エディター内部のストアとAPIから取得した公開データの参照を分ける。
  const [initialScore] = useState(() => structuredClone(score));
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return (
    <>
      <div className="pufu-editor-shell public-pufu-preview" aria-label="プ譜（閲覧のみ）">
        <div className="pufu-editor-root">
          <ProjectScore
            uniqueKey={`public-${id}`}
            initScore={initialScore}
            preview
            showProgress
            lang="ja"
            mobile={mobile}
            textSize="base"
            dark={theme === 'dark'}
            border={!mobile}
          />
        </div>
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
