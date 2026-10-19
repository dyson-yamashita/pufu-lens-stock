import { useState } from 'react';
import { youtubeThumbnailUrl } from '../shared/youtube';

export default function YouTubeThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = youtubeThumbnailUrl(url);
  return src && !failed ? (
    <img
      className="youtube-thumbnail-image"
      src={src}
      alt=""
      width="320"
      height="180"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="youtube-thumbnail-fallback">サムネイルを表示できません。詳細を開く</span>
  );
}
