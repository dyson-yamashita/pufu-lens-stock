import { t, useLanguage } from './i18n';
import { youtubeEmbedUrl } from '../shared/youtube';
export default function YouTubePlayer({ url }: { url: string }) {
  useLanguage();
  const src = youtubeEmbedUrl(url);
  if (!src) return <p>{t('ui.you_tube_player.this_url_cannot_be_embedded_please_open_it_on')}</p>;
  return (
    <div className="youtube-embed">
      <iframe
        className="youtube-player"
        src={src}
        title={t('ui.you_tube_player.youtube_video_player')}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
      <p className="local-model-note">
        {t('ui.you_tube_player.if_playback_fails_open_the_video_on_youtube')}
      </p>
    </div>
  );
}
