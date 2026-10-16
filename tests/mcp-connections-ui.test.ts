import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import McpConnections from '../src/McpConnections';

afterEach(() => vi.unstubAllGlobals());

it('接続一覧を読み込む前から現在のサイトの接続URLとコピー操作を表示する', () => {
  vi.stubGlobal('window', { location: { origin: 'https://lens.example.com' } });
  const { document } = parseHTML(renderToStaticMarkup(createElement(McpConnections)));
  expect(document.querySelector('#mcp-url')?.getAttribute('value')).toBe(
    'https://lens.example.com/mcp',
  );
  expect(document.querySelector('button[aria-label="MCPサーバーのURLをコピー"]')).not.toBeNull();
});
