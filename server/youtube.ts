import { z } from 'zod';
import type { YouTubeMetadata } from '../shared/domain';
import type { Env } from './env';
import { limitedText } from './ingest';

export function youtubeVideoId(value: string): string | null {
  const url = new URL(value);
  const hosts = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
  ];
  if (!hosts.includes(url.hostname)) return null;
  const id = url.hostname.endsWith('youtu.be')
    ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
    : /^\/watch\/?$/.test(url.pathname)
      ? url.searchParams.get('v')
      : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    throw new Error(
      'YouTubeの動画URLを入力してください。再生リストやチャンネルのURLには対応していません。',
    );
  return id;
}

const videoSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(20000).default(''),
        channelTitle: z.string().max(300).default(''),
        thumbnails: z.record(z.string(), z.object({ url: z.string() })).default({}),
      }),
    }),
  ),
});
class YouTubeFetchError extends Error {}

export async function fetchYouTubeVideo(
  env: Env,
  id: string,
): Promise<{
  title: string;
  text: string;
  youtube: YouTubeMetadata;
}> {
  const key = env.YOUTUBE_API_KEY?.trim();
  if (!key)
    throw new Error(
      'YouTubeの情報取得には、管理者によるYOUTUBE_API_KEYの設定が必要です。設定後に取得を再試行してください。',
    );
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('id', id);
    url.searchParams.set('fields', 'items(id,snippet(title,description,channelTitle,thumbnails))');
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': key, Accept: 'application/json' },
      // 認証情報をリダイレクト先へ送らない。
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      let reason = '';
      try {
        const error = JSON.parse(await limitedText(response)) as {
          error?: { errors?: { reason?: string }[] };
        };
        reason = error.error?.errors?.[0]?.reason ?? '';
      } catch {
        /* APIのエラー本文は表示しない。 */
      }
      const message =
        response.status === 429 ||
        ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason)
          ? 'YouTube Data APIの利用上限に達しています。時間をおいて再試行してください。'
          : reason === 'accessNotConfigured'
            ? 'YouTube Data API v3の有効化とAPIキーの設定を確認してください。'
            : [400, 401, 403].includes(response.status)
              ? 'YouTubeのAPIキー・APIの有効化・キーの利用制限を確認してください。'
              : `YouTubeの動画情報を取得できません（HTTP ${response.status}）。時間をおいて再試行してください。`;
      throw new YouTubeFetchError(message);
    }
    const json = videoSchema.parse(JSON.parse(await limitedText(response)));
    const video = json.items.find((item) => item.id === id);
    if (!video)
      throw new YouTubeFetchError(
        'YouTubeの動画が見つかりません。削除済み・非公開、またはAPIで取得できない動画の可能性があります。',
      );
    const { title, channelTitle, thumbnails } = video.snippet;
    const description = video.snippet.description.trim();
    const thumbnailUrl =
      ['maxres', 'standard', 'high', 'medium', 'default']
        .map((size) => thumbnails[size]?.url)
        .find((value) => {
          if (!value) return false;
          try {
            const thumbnail = new URL(value);
            return (
              thumbnail.protocol === 'https:' &&
              thumbnail.hostname === 'i.ytimg.com' &&
              !thumbnail.username &&
              !thumbnail.password &&
              !thumbnail.port
            );
          } catch {
            return false;
          }
        }) ?? null;
    return {
      title,
      text: [
        'YouTubeの動画情報です。動画本編・字幕は取得していません。',
        `タイトル: ${title}`,
        ...(channelTitle ? [`チャンネル: ${channelTitle}`] : []),
        description
          ? `説明文:\n${description}`
          : '説明文はありません。タイトルとチャンネル名のみ取得しました。',
      ].join('\n\n'),
      youtube: { videoId: id, channelTitle, thumbnailUrl, hasDescription: Boolean(description) },
    };
  } catch (error) {
    // Fetch例外やAPI応答に含まれるキー・URLを利用者へ流さない。
    if (error instanceof YouTubeFetchError) throw error;
    throw new Error(
      'YouTubeの動画情報を取得できませんでした。時間をおいて再試行するか、APIキーの設定を確認してください。',
    );
  }
}
