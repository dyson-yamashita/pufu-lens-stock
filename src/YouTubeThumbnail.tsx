import { t, useLanguage } from './i18n';
import { useState } from 'react';
import { youtubeThumbnailUrl } from '../shared/youtube';
export default function YouTubeThumbnail({ url }: { url: string }) {
  useLanguage();
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
    <span className="youtube-thumbnail-fallback">
      {t('ui.you_tube_thumbnail.cannot_display_thumbnail_open_details')}
    </span>
  );
}
