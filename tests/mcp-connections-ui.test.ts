import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../src/api';
import { setLanguage } from '../src/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import McpConnections from '../src/McpConnections';

vi.mock('../src/api', () => ({ api: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('接続一覧を読み込む前から現在のサイトの接続URLとコピー操作を表示する', () => {
  vi.stubGlobal('window', { location: { origin: 'https://lens.example.com' } });
  const { document } = parseHTML(renderToStaticMarkup(createElement(McpConnections)));
  expect(document.querySelector('#mcp-url')?.getAttribute('value')).toBe(
    'https://lens.example.com/mcp',
  );
  expect(document.querySelector('button[aria-label="MCPサーバーのURLをコピー"]')).not.toBeNull();
});

it('shows granted connection permissions in English while retaining connection names and scope IDs', async () => {
  const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://lens.example.com' },
  });
  const connection = {
    id: 'connection',
    client_name: '接続先の名前',
    project_name: '保存したプロジェクト',
    scopes: [
      'projects:read',
      'stocks:read',
      'stocks:write',
      'questions:read',
      'questions:write',
      'pufus:write',
      'offline_access',
      'future:scope',
    ],
    created_at: '2026-10-30T00:00:00Z',
    expires_at: null,
  };
  const scopeIds = [...connection.scopes];
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/api/v1/mcp/connections'
      ? { enabled: true, url: 'https://lens.example.com/mcp', connections: [connection] }
      : { configured: false, available: true },
  );
  setLanguage('en');
  const root = createRoot(dom.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(McpConnections)));
    const row = dom.document.querySelector('.mcp-connections .token-row')!;
    expect(row.querySelector('strong')?.textContent).toBe('接続先の名前');
    expect(row.querySelector('p')?.textContent).toBe('保存したプロジェクト');
    expect(row.querySelectorAll('p')[1].textContent).toBe(
      'List projects · Search and read stocks, including body text and comments · Add stocks and comments · Search and read questions, insights and pufus, and read comments · Add questions and insights, and comments on questions, insights and pufus · Create and edit pufus and change question/insight associations · Refresh tokens to maintain the connection · future:scope',
    );
    expect(connection.scopes).toEqual(scopeIds);
  } finally {
    await act(async () => root.unmount());
  }
});
