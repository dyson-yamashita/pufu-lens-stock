export const youtubeUnavailableMessage =
  'YouTubeのコンテンツは記録できません。URLのみストックに残します。';

export function isYouTubeUrl(value: string): boolean {
  const host = new URL(value).hostname.replace(/\.$/, '');
  return ['youtube.com', 'youtu.be', 'youtube-nocookie.com'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}
