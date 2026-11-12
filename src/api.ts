import { beginFeedbackRequest } from './feedback-events';
import { t, intlLocale, applicationError } from './i18n';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const finish = beginFeedbackRequest(path, (options.method ?? 'GET').toUpperCase());
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const data: unknown = await response.json().catch((error: unknown) => {
      if (response.ok) throw error;
      return null;
    });
    const errorData = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    if (!response.ok) {
      finish(
        response.status === 401
          ? 'ignore'
          : [400, 422].includes(response.status)
            ? 'validation'
            : response.status === 408 || response.status >= 500
              ? 'network'
              : 'operation',
      );
      throw new ApiError(
        (typeof errorData.error === 'string' && errorData.error
          ? applicationError(errorData.error)
          : t('ui.api.the_operation_failed')) +
          (response.status === 429 && typeof errorData.retry_at === 'string' && errorData.retry_at
            ? t('ui.api.retry_around_value', {
                value0: new Date(errorData.retry_at).toLocaleString(intlLocale()),
              })
            : ''),
        response.status,
      );
    }
    finish('success');
    return data as T;
  } catch (error) {
    finish(
      error instanceof Error && error.name === 'AbortError'
        ? 'ignore'
        : error instanceof TypeError
          ? 'network'
          : 'operation',
    );
    throw error;
  }
}
export const send = <T>(path: string, data: unknown = {}, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(data) });
export function createRequestId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  // 同じWi-Fi内のHTTP接続ではrandomUUIDが利用できないため、ランダム値からUUID v4を作る。
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
