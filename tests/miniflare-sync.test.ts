import { Miniflare } from 'miniflare';
import { expect, it, vi } from 'vitest';

it('前の通知で同期RPCの待機が早く解除されても、対応するDB応答を待って次の呼び出しも継続する', async () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("test"); } }',
    compatibilityDate: '2026-07-30',
    d1Databases: { DB: 'sync-proxy-regression' },
  });
  try {
    const db = await runtime.getD1Database('DB');
    // 遅延した前リクエストのnotifyで待機が解除される状態を再現する。
    // DB本体とworkerとの通信は実際のMiniflareを使う。
    const wait = vi.spyOn(Atomics, 'wait').mockImplementationOnce(() => 'ok');
    try {
      expect(await db.prepare('SELECT 41 AS value').first()).toEqual({ value: 41 });
      expect(wait).toHaveBeenCalled();
    } finally {
      wait.mockRestore();
    }
    expect(await db.prepare('SELECT ? AS value').bind(42).first()).toEqual({ value: 42 });
  } finally {
    await runtime.dispose();
  }
});
