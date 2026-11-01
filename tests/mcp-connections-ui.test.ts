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

it('編集のキャンセルと保存失敗後の再試行を扱い、保存結果を一覧に反映する', async () => {
  const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://lens.example.com' },
  });
  setLanguage('ja');
  const connection = {
    id: 'edit-connection',
    client_name: 'ChatGPT',
    project_id: null,
    project_name: null,
    scopes: ['projects:read'],
    authorized_scopes: ['projects:read', 'stocks:read'],
    created_at: '2026-10-30T00:00:00Z',
    expires_at: null,
  };
  let fail = true;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH') {
      if (fail) throw new Error('保存できませんでした。');
      return { connection: { ...connection, client_name: '保存した名前' } };
    }
    if (path === '/api/v1/mcp/connections')
      return { enabled: true, url: 'https://lens.example.com/mcp', connections: [connection] };
    if (path === '/api/v1/projects') return { projects: [{ id: 'p1', name: 'プロジェクト' }] };
    return { configured: false, available: true };
  });
  const root = createRoot(dom.document.getElementById('root')!);
  const click = async (text: string) => {
    const button = [...dom.document.querySelectorAll('button')].find(
      (node) => node.textContent === text,
    )!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  const submit = async () =>
    act(async () => {
      dom.document
        .querySelector('form.mcp-connection-editor')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
  try {
    await act(async () => root.render(createElement(McpConnections)));
    await click('編集');
    const permission = (label: string) =>
      [...dom.document.querySelectorAll('.mcp-permission')]
        .find((node) => node.textContent === label)!
        .querySelector('input') as HTMLInputElement;
    expect(permission('ストックを検索・閲覧（本文・コメントを含む）').disabled).toBe(false);
    expect(permission('ストックとコメントを追加').disabled).toBe(true);
    expect(permission('プロジェクトのメモリを閲覧').disabled).toBe(true);
    await click('キャンセル');
    expect(dom.document.querySelector('.mcp-connection-editor')).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(
      false,
    );
    await click('編集');
    await submit();
    expect(dom.document.querySelector('.mcp-connection-editor [role="alert"]')?.textContent).toBe(
      '保存できませんでした。',
    );
    expect(dom.document.querySelector('.mcp-connections strong')?.textContent).toBe('ChatGPT');
    fail = false;
    await submit();
    expect(dom.document.querySelector('.mcp-connection-editor')).toBeNull();
    expect(dom.document.querySelector('.mcp-connections strong')?.textContent).toBe('保存した名前');
    expect(api).toHaveBeenCalledWith('/api/v1/mcp/connections/edit-connection', {
      method: 'PATCH',
      body: JSON.stringify({
        client_name: 'ChatGPT',
        project_ids: null,
        scopes: ['projects:read'],
      }),
    });
  } finally {
    await act(async () => root.unmount());
  }
});
