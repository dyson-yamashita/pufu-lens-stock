import { z } from 'zod';
import { pufuViewerReadySchema, type PufuViewerImage } from '../../shared/pufu-viewer';

type ToolResult = { isError?: boolean; structuredContent?: unknown };
export type ViewerState = {
  status: 'loading' | 'ready' | 'not_created' | 'generating' | 'error' | 'forbidden';
  message: string;
  image?: PufuViewerImage;
  loadImage: boolean;
  updated: boolean;
};
const selection = z.object({
  question_id: z.string().min(1).max(100).nullable().optional(),
  pufu_id: z.string().min(1).max(100).optional(),
});
type Selection = z.infer<typeof selection>;
export const needsNewUrl = (image: Pick<PufuViewerImage, 'expires_at'>, now: number) =>
  !Number.isFinite(Date.parse(image.expires_at)) || Date.parse(image.expires_at) - now < 60_000;

// ID固定、同時取得の集約、遅延応答の排除と画像エラーの再試行上限を一か所で管理する。
export class PufuViewerController {
  state: ViewerState = {
    status: 'loading',
    message: '読み込み中です…',
    loadImage: false,
    updated: false,
  };
  target?: Selection;
  private confirmed = false;
  private epoch = 0;
  private pending?: Promise<void>;
  private imageRetryUsed = false;
  constructor(
    private readonly options: {
      origin: string;
      call: (args: Selection) => Promise<ToolResult>;
      changed: (state: ViewerState) => void;
      now?: () => number;
    },
  ) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private emit() {
    this.options.changed(this.state);
  }
  setInput(value: unknown) {
    const parsed = selection.safeParse(value);
    if (!this.confirmed && parsed.success) this.target = parsed.data;
  }
  fail(message: string, status: ViewerState['status'] = 'error') {
    this.state = { ...this.state, status, message, loadImage: false };
    this.emit();
  }
  private validUrl(image: PufuViewerImage) {
    const url = new URL(image.image_url),
      download = new URL(image.download_url);
    return (
      url.origin === this.options.origin &&
      /^\/api\/pufu-images\/[A-Za-z0-9_-]{43}\.png$/.test(url.pathname) &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '' &&
      download.origin === url.origin &&
      download.pathname === url.pathname &&
      download.search === '?download=1' &&
      download.hash === '' &&
      download.username === '' &&
      download.password === ''
    );
  }
  private accept(result: ToolResult, refreshing: boolean) {
    if (result.isError) {
      const error = z
        .object({ status: z.number().optional(), error: z.string().optional() })
        .safeParse(result.structuredContent);
      const code = error.success ? error.data.status : undefined;
      if (code === 401 || code === 403 || code === 404)
        this.fail('プ譜が削除されたか、閲覧が許可されていません。', 'forbidden');
      else if (
        code === 409 &&
        error.success &&
        error.data.error?.includes('作成が完了していません')
      )
        this.fail('プ譜を生成中です。しばらくしてから再取得してください。', 'generating');
      else this.fail('プ譜を取得できませんでした。再取得するか、会話で表示を依頼してください。');
      return;
    }
    const empty = z
      .object({ status: z.literal('not_created'), question_id: z.string() })
      .safeParse(result.structuredContent);
    if (empty.success) {
      if (!this.confirmed) this.target = { question_id: empty.data.question_id };
      this.fail('この問い・気づきのプ譜はまだ作成されていません。', 'not_created');
      return;
    }
    const parsed = pufuViewerReadySchema.safeParse(result.structuredContent);
    if (!parsed.success || !this.validUrl(parsed.data)) {
      this.fail('表示データを確認できません。会話で再度表示を依頼してください。');
      return;
    }
    const image = parsed.data;
    if (this.confirmed && image.pufu_id !== this.target?.pufu_id) {
      if (refreshing) this.fail('対象のプ譜と取得結果が一致しません。再取得してください。');
      return;
    }
    const previous = this.state.image;
    if (
      previous &&
      (image.revision < previous.revision ||
        (image.revision === previous.revision && image.phase < previous.phase))
    ) {
      if (refreshing) this.fail('古い取得結果のため表示を更新しませんでした。再取得してください。');
      return;
    }
    // 問いの紐付けを変更・解除しても、同じプ譜を再取得する。
    this.target = { pufu_id: image.pufu_id };
    this.confirmed = true;
    const expired = needsNewUrl(image, this.now());
    const alreadyDisplayed =
      !expired && this.state.status === 'ready' && previous?.image_url === image.image_url;
    this.state = {
      status: alreadyDisplayed ? 'ready' : 'loading',
      message: alreadyDisplayed ? this.state.message : '画像を読み込み中です…',
      image,
      loadImage: !expired,
      updated:
        this.state.updated ||
        (!!previous && (previous.revision !== image.revision || previous.phase !== image.phase)),
    };
    this.emit();
    if (expired && refreshing)
      this.fail('新しい画像リンクを取得できませんでした。再取得してください。');
  }
  receive(result: ToolResult) {
    // ホスト通知が処理中の古い取得より優先される。古い通知は現在の取得を妨げない。
    const parsed = pufuViewerReadySchema.safeParse(result.structuredContent);
    const previous = this.state.image;
    if (
      parsed.success &&
      previous &&
      (parsed.data.revision < previous.revision ||
        (parsed.data.revision === previous.revision && parsed.data.phase < previous.phase) ||
        parsed.data.pufu_id !== previous.pufu_id)
    )
      return;
    if (this.confirmed && !result.isError && !parsed.success) return;
    this.epoch++;
    this.pending = undefined;
    this.accept(result, false);
    if (
      this.state.status === 'loading' &&
      this.state.image &&
      needsNewUrl(this.state.image, this.now())
    )
      void this.refresh();
  }
  refresh(manual = false): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.target) {
      this.fail('会話で「プ譜を表示して」と再度依頼してください。');
      return Promise.resolve();
    }
    if (manual) this.imageRetryUsed = false;
    const epoch = ++this.epoch,
      target = { ...this.target };
    this.state = {
      ...this.state,
      status: 'loading',
      message: 'プ譜を再取得しています…',
      loadImage: false,
    };
    this.emit();
    const operation = Promise.resolve()
      .then(() => this.options.call(target))
      .then((result) => {
        if (epoch === this.epoch) this.accept(result, true);
      })
      .catch(() => {
        if (epoch === this.epoch)
          this.fail('通信できませんでした。接続を確認し、再取得してください。');
      })
      .finally(() => {
        if (this.pending === operation) this.pending = undefined;
      });
    this.pending = operation;
    return operation;
  }
  cancel() {
    this.epoch++;
    this.pending = undefined;
    this.fail('取得を中止しました。再取得できます。');
  }
  loaded(url: string) {
    if (!this.pending && this.state.loadImage && url === this.state.image?.image_url) {
      this.state = {
        ...this.state,
        status: 'ready',
        message: 'プ譜を表示しています。拡大して確認できます。',
      };
      this.emit();
    }
  }
  imageFailed(url: string) {
    if (url !== this.state.image?.image_url || !this.state.loadImage) return;
    if (this.imageRetryUsed) {
      this.fail('画像を読み込めませんでした。再取得するか、PNGを開いて確認してください。');
      return;
    }
    this.imageRetryUsed = true;
    void this.refresh();
  }
  async imageForOpening() {
    if (this.pending) await this.pending;
    if (!this.state.image || needsNewUrl(this.state.image, this.now())) await this.refresh();
    const image = this.state.image;
    return image && this.state.status !== 'forbidden' && !needsNewUrl(image, this.now())
      ? image
      : undefined;
  }
  returned() {
    if (
      this.state.status !== 'forbidden' &&
      this.state.image &&
      needsNewUrl(this.state.image, this.now())
    )
      void this.refresh();
  }
}
