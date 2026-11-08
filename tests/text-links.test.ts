import { expect, it } from 'vitest';
import { textLinks } from '../shared/text-links';

it.each([
  [
    '前後の文章\n https://example.com/a?x=1&y=2#part \n末尾',
    ['https://example.com/a?x=1&y=2#part'],
  ],
  [
    '参照「https://example.com/日本語」。次は http://example.org/path, 続き',
    ['https://example.com/日本語', 'http://example.org/path'],
  ],
  [
    '(https://example.com/a_(b)). [https://example.org/x]',
    ['https://example.com/a_(b)', 'https://example.org/x'],
  ],
  [
    'HTTPS://example.com/a https://example.com/b',
    ['HTTPS://example.com/a', 'https://example.com/b'],
  ],
  ['javascript:alert(1) data:text/html,<script>alert(1)</script> ftp://example.com/a', []],
  [
    'https:// https://[bad] https://example.com:invalid/ 後続 https://example.org/',
    ['https://example.org/'],
  ],
  [
    '<img src=x onerror=alert(1)> https://example.com/" onclick="alert(1)',
    ['https://example.com/'],
  ],
  ['', []],
])('URLを安全に分割し、元の文章を保持する: %s', (text, expected) => {
  const parts = textLinks(text);
  expect(parts.map((part) => part.text).join('')).toBe(text);
  expect(parts.flatMap((part) => (part.href ? [part.href] : []))).toEqual(expected);
});
