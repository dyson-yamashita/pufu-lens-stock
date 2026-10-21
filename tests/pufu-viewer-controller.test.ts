import { describe, expect, it, vi } from 'vitest';
import { PufuViewerController, needsNewUrl } from '../src/mcp-pufu-viewer/controller';
import type { PufuViewerImage } from '../shared/pufu-viewer';
const origin = 'https://pufu-lens.dev';
const start = Date.parse('2026-10-21T10:00:00Z');
function image(overrides: Partial<PufuViewerImage> = {}): PufuViewerImage {
  const token = 'A'.repeat(43);
  return {
    status: 'ready',
    question_id: 'question',
    project_id: 'project',
    pufu_id: 'selected-pufu',
    title: '獲得目標',
    phase: 1,
    revision: 1,
    updated_at: '2026-10-21T09:00:00Z',
    image_url: `${origin}/api/pufu-images/${token}.png`,
    download_url: `${origin}/api/pufu-images/${token}.png?download=1`,
    expires_at: new Date(start + 3600000).toISOString(),
    mime_type: 'image/png',
    width: 1760,
    height: 1684,
    ...overrides,
  };
}
const result = (value = image()) => ({ structuredContent: value });
function setup(call = vi.fn(async () => result())) {
  let now = start;
  const changed = vi.fn();
  const controller = new PufuViewerController({ origin, call, changed, now: () => now });
  return {
    controller,
    call,
    changed,
    time: (value: number) => {
      now = value;
    },
  };
}
describe('プ譜ビューアーの期限・競合・再試行', () => {
  it.each([
    [60001, false],
    [60000, false],
    [59999, true],
    [0, true],
    [-1, true],
  ])('残り%sミリ秒の期限判定', (remaining, expired) => {
    expect(needsNewUrl({ expires_at: new Date(start + remaining).toISOString() }, start)).toBe(
      expired,
    );
  });
  it('有効な画像は再発行せず、load前・古いloadでは成功扱いにしない', () => {
    const { controller, call } = setup();
    controller.receive(result());
    expect(controller.state.status).toBe('loading');
    controller.loaded('https://elsewhere.invalid/old.png');
    expect(controller.state.status).toBe('loading');
    controller.loaded(image().image_url);
    expect(controller.state.status).toBe('ready');
    expect(call).not.toHaveBeenCalled();
  });
  it('表示済み画像と同じ結果の再通知では読み込み中に戻らない', () => {
    const { controller, call } = setup();
    controller.receive(result());
    controller.loaded(image().image_url);
    controller.receive(result());
    expect(controller.state.status).toBe('ready');
    expect(controller.state.loadImage).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });
  it.each([0, 59999])('初回の期限切れ・期限間近(%s)は確定IDを使って更新する', async (remaining) => {
    const { controller, call } = setup();
    controller.setInput({ question_id: 'question' });
    controller.receive(result(image({ expires_at: new Date(start + remaining).toISOString() })));
    await controller.refresh();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith({ question_id: 'question', pufu_id: 'selected-pufu' });
    expect(controller.state.loadImage).toBe(true);
    expect(controller.state.status).toBe('loading');
  });
  it('1時間経過だけで更新せず、表示復帰と保存の同時要求を1回にまとめる', async () => {
    const { controller, call, time } = setup();
    controller.receive(result());
    controller.loaded(image().image_url);
    time(start + 3600001);
    expect(call).not.toHaveBeenCalled();
    call.mockResolvedValue(result(image({ expires_at: new Date(start + 7200000).toISOString() })));
    controller.returned();
    controller.returned();
    const opened = await controller.imageForOpening();
    expect(opened?.pufu_id).toBe('selected-pufu');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('画像エラーでは有効なURLでも最大1回だけ再取得し、手動操作で再開できる', async () => {
    const { controller, call } = setup();
    controller.receive(result());
    controller.imageFailed(image().image_url);
    controller.imageFailed(image().image_url);
    await controller.refresh();
    expect(call).toHaveBeenCalledTimes(1);
    controller.imageFailed(image().image_url);
    expect(controller.state.status).toBe('error');
    expect(call).toHaveBeenCalledTimes(1);
    await controller.refresh(true);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('自動再取得後の通信断は繰り返さない', async () => {
    const { controller, call } = setup();
    controller.receive(result());
    call.mockRejectedValue(new Error('offline'));
    controller.imageFailed(image().image_url);
    await controller.refresh();
    expect(controller.state.status).toBe('error');
    expect(call).toHaveBeenCalledTimes(1);
    controller.imageFailed(image().image_url);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('ホストが取得結果を再通知しても、自動再試行の上限をリセットしない', async () => {
    const { controller, call } = setup();
    controller.receive(result());
    controller.imageFailed(image().image_url);
    await controller.refresh();
    controller.receive(result());
    controller.imageFailed(image().image_url);
    expect(controller.state.status).toBe('error');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('中止後に届いた応答を表示せず、再取得の対象も変えない', async () => {
    let finish!: (value: ReturnType<typeof result>) => void;
    const call = vi.fn(
      () =>
        new Promise<ReturnType<typeof result>>((resolve) => {
          finish = resolve;
        }),
    );
    const { controller } = setup(call);
    controller.receive(result());
    const pending = controller.refresh();
    await Promise.resolve();
    controller.cancel();
    finish(result(image({ revision: 3 })));
    await pending;
    expect(controller.state.status).toBe('error');
    expect(controller.state.image?.revision).toBe(1);
    expect(controller.state.loadImage).toBe(false);
  });
  it('再取得が別のプ譜を返した場合は読み込み中のままにせず失敗を伝える', async () => {
    const { controller, call } = setup();
    controller.receive(result());
    call.mockResolvedValue(result(image({ pufu_id: 'another-pufu' })));
    await controller.refresh();
    expect(controller.state.status).toBe('error');
    expect(controller.state.image?.pufu_id).toBe('selected-pufu');
  });
  it('更新時は同じプ譜の最新局面と変更通知を返し、別のプ譜へ切り替えない', async () => {
    const { controller, call } = setup();
    controller.receive(result());
    controller.setInput({ question_id: 'other', pufu_id: 'different' });
    call.mockResolvedValue(result(image({ phase: 3, revision: 4, title: '新しい目標' })));
    await controller.refresh();
    expect(controller.state.image).toMatchObject({ phase: 3, revision: 4, title: '新しい目標' });
    expect(controller.state.updated).toBe(true);
    expect(call).toHaveBeenCalledWith({ question_id: 'question', pufu_id: 'selected-pufu' });
    controller.receive(result(image({ pufu_id: 'different', revision: 9 })));
    expect(controller.state.image?.pufu_id).toBe('selected-pufu');
  });
  it('遅れて完了した取得結果・古い通知で新しい画像を上書きしない', async () => {
    let finish!: (value: ReturnType<typeof result>) => void;
    const call = vi.fn(
      () =>
        new Promise<ReturnType<typeof result>>((resolve) => {
          finish = resolve;
        }),
    );
    const { controller } = setup(call);
    controller.receive(result());
    const old = controller.refresh();
    await Promise.resolve();
    controller.receive(result(image({ revision: 5 })));
    controller.loaded(image().image_url);
    finish(result(image({ revision: 2 })));
    await old;
    controller.receive(result(image({ revision: 1 })));
    expect(controller.state.image?.revision).toBe(5);
    expect(controller.state.status).toBe('ready');
  });
  it.each([
    [403, 'forbidden'],
    [404, 'forbidden'],
    [409, 'generating'],
    [503, 'error'],
  ] as const)('エラー%sを%sとして区別する', (code, status) => {
    const { controller } = setup();
    controller.receive({
      isError: true,
      structuredContent: { status: code, error: 'プ譜の作成が完了していません' },
    });
    expect(controller.state.status).toBe(status);
    expect(controller.state.loadImage).toBe(false);
  });
  it('未作成は画像を出さず、閲覧不可の後に表示復帰で再発行しない', () => {
    const { controller, call, time } = setup();
    controller.receive({ structuredContent: { status: 'not_created', question_id: 'question' } });
    expect(controller.state.status).toBe('not_created');
    expect(controller.state.image).toBeUndefined();
    controller.receive(result());
    controller.receive({ isError: true, structuredContent: { status: 404 } });
    time(start + 3600001);
    controller.returned();
    expect(call).not.toHaveBeenCalled();
  });
  it('不正な外部URLやURL発行失敗を成功画像として扱わない', () => {
    const { controller } = setup();
    controller.receive(result(image({ image_url: 'https://evil.invalid/image.png' })));
    expect(controller.state.status).toBe('error');
    expect(controller.state.loadImage).toBe(false);
    controller.receive({
      structuredContent: { ...image(), image_url: undefined, image_url_error: 'failed' },
    });
    expect(controller.state.status).toBe('error');
  });
  it('更新後のURLも期限切れなら自動取得を続けない', async () => {
    const expired = image({ expires_at: new Date(start - 1).toISOString() });
    const { controller, call } = setup(vi.fn(async () => result(expired)));
    controller.receive(result(expired));
    await controller.refresh();
    expect(controller.state.status).toBe('error');
    expect(call).toHaveBeenCalledTimes(1);
  });
});
