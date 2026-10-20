import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';

describe('ローカル画面のWorkers AI設定表示', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => app.dispose());

  it.each([false, true])(
    'AIバインディングの有無とモデルを公開する（設定あり: %s）',
    async (enabled) => {
      const run = vi.fn(async () => ({ response: '{}' }));
      if (enabled) app.env.AI = { run };
      const response = await app.request('/api/config', { headers: { Cookie: '' } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        demo: true,
        appUrl: app.env.APP_URL,
        googleConfigured: false,
        aiEnabled: enabled,
        aiModel: enabled ? app.env.AI_MODEL : null,
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('接続先URLは閲覧中のホストではなくサーバー設定のオリジンを返す', async () => {
    app.env.APP_URL = 'https://configured.example.com/';
    const response = await app.request('/api/config', {
      host: 'https://viewer.example.net',
      headers: { Cookie: '' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ appUrl: 'https://configured.example.com' });
  });
});
