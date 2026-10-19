export const youtubeUnavailableMessage =
  'YouTubeのコンテンツは記録できません。URLのみストックに残します。';

export function isYouTubeUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.replace(/\.$/, '');
  } catch {
    return false;
  }
  return ['youtube.com', 'youtu.be', 'youtube-nocookie.com'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function youtubeEmbedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    !isYouTubeUrl(value)
  )
    return null;
  const host = url.hostname.replace(/\.$/, '');
  const id =
    host === 'youtu.be' || host.endsWith('.youtu.be')
      ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
      : /^\/watch\/?$/.test(url.pathname)
        ? url.searchParams.get('v')
        : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  return id && /^[A-Za-z0-9_-]{11}$/.test(id)
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : null;
}

export function youtubeDisplayTitle(title: string): string {
  return title === 'YouTube（記録不可）' ? 'YouTube' : title;
}

export function youtubeThumbnailUrl(value: string): string | null {
  const id = youtubeEmbedUrl(value)?.split('/').at(-1);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}
