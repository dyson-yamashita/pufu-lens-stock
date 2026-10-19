import { youtubeEmbedUrl } from '../shared/youtube';

export default function YouTubePlayer({ url }: { url: string }) {
  const src = youtubeEmbedUrl(url);
  if (!src) return <p>このURLは動画を埋め込めません。YouTubeで開いてご覧ください。</p>;
  return (
    <div className="youtube-embed">
      <iframe
        className="youtube-player"
        src={src}
        title="YouTube動画プレーヤー"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
      <p className="local-model-note">再生できない場合は、YouTubeで開いてご覧ください。</p>
    </div>
  );
}
