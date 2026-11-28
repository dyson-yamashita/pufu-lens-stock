export const minArticleTextLength = 200;

export function isShortRetrievedText(text: unknown): text is string {
  return typeof text === 'string' && text.length < minArticleTextLength && text.trim().length > 0;
}
