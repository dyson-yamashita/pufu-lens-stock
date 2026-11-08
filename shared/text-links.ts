export type TextLinkPart = { text: string; href?: string };

/** Split plain text without interpreting HTML or changing its whitespace. */
export function textLinks(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`「」『』【】（）〈〉《》、。]+/gi)) {
    const candidate = match[0];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const balance: Record<string, number> = {};
    for (const [close, open] of Object.entries(pairs)) {
      balance[close] = candidate.split(close).length - candidate.split(open).length;
    }
    let end = candidate.length;
    while (end > 0) {
      const last = candidate[end - 1];
      if (/[.,!?;:]/.test(last)) end--;
      else if (balance[last] > 0) {
        balance[last]--;
        end--;
      } else break;
    }
    const href = candidate.slice(0, end);
    try {
      const url = new URL(href);
      if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) continue;
    } catch {
      continue;
    }
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: href, href });
    cursor = match.index + end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
