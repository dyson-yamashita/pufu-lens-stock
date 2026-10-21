import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { PufuViewerController, needsNewUrl, type ViewerState } from './controller';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = element<HTMLDivElement>('viewport');
const app = new App(
  { name: 'Pufu Lens プ譜ビューアー', version: '1.0.0' },
  {},
  { strict: true, autoResize: true },
);
let zoom = 1,
  imageElement: HTMLImageElement | undefined;
let bridgeReady = false;
const controller = new PufuViewerController({
  origin: document.documentElement.dataset.imageOrigin!,
  call: async (args) => {
    await connection;
    if (!app.getHostCapabilities()?.serverTools) throw new Error('tool_bridge_unavailable');
    return app.callServerTool({ name: 'get_pufu_image', arguments: args });
  },
  changed: render,
});
function render(state: ViewerState) {
  element('status').textContent = state.message;
  element('updated').hidden = !state.updated || state.status !== 'ready';
  element('title').textContent = state.image?.title || 'プ譜';
  element('metadata').textContent = state.image
    ? `局面 ${state.image.phase} · 更新 ${state.image.updated_at ? new Date(state.image.updated_at).toLocaleString() : '日時不明'}`
    : '';
  element('target').textContent = controller.target
    ? `問い: ${controller.target.question_id} / プ譜: ${controller.target.pufu_id ?? '未選択'}`
    : '';
  element<HTMLButtonElement>('download').disabled = !state.image || state.status === 'forbidden';
  element<HTMLButtonElement>('retry').disabled = !bridgeReady || state.status === 'loading';
  const external = element<HTMLAnchorElement>('external');
  if (
    !state.image ||
    state.status === 'forbidden' ||
    external.getAttribute('href') !== state.image.download_url
  ) {
    external.hidden = true;
    external.removeAttribute('href');
  }
  if (!state.loadImage) {
    viewport.replaceChildren();
    imageElement = undefined;
    sizeImage();
    return;
  }
  if (state.image && imageElement?.dataset.source !== state.image.image_url) {
    const url = state.image.image_url;
    imageElement = new Image();
    imageElement.alt = state.image.title || 'プ譜';
    imageElement.referrerPolicy = 'no-referrer';
    imageElement.draggable = false;
    imageElement.dataset.source = url;
    imageElement.onload = () => {
      sizeImage();
      controller.loaded(url);
    };
    imageElement.onerror = () => controller.imageFailed(url);
    imageElement.src = url;
    viewport.replaceChildren(imageElement);
  }
  sizeImage();
}
function sizeImage() {
  const image = controller.state.image;
  if (!imageElement || !image) {
    element<HTMLButtonElement>('zoom-out').disabled = true;
    element<HTMLButtonElement>('zoom-in').disabled = true;
    return;
  }
  const style = getComputedStyle(viewport);
  const width = Math.max(
    1,
    viewport.getBoundingClientRect().width -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.borderRightWidth),
  );
  const imageWidth = imageElement.naturalWidth || image.width;
  const imageHeight = imageElement.naturalHeight || image.height;
  // 横幅100%時の画像高に枠を合わせ、SDKのautoResizeでホストへ通知する。
  // 拡大時もこの高さを保ち、画像内をパンできるようにする。
  viewport.style.height = `${Math.ceil((width * imageHeight) / imageWidth) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
  viewport.dataset.zoomed = String(zoom > 1);
  imageElement.style.width = `${zoom * 100}%`;
  element<HTMLButtonElement>('zoom-out').disabled = zoom <= 1;
  element<HTMLButtonElement>('zoom-in').disabled = zoom >= 6;
}
function setZoom(value: number) {
  zoom = Math.max(1, Math.min(6, value));
  sizeImage();
}
element('zoom-in').onclick = () => setZoom(zoom + 0.5);
element('zoom-out').onclick = () => setZoom(zoom - 0.5);
element('fit').onclick = () => {
  setZoom(1);
  viewport.scrollTo(0, 0);
};
element('retry').onclick = () => {
  void controller.refresh(true);
};
element('download').onclick = async () => {
  const image = await controller.imageForOpening();
  if (!image) return;
  try {
    if (!app.getHostCapabilities()?.openLinks) throw new Error('external_link_fallback');
    const result = await app.openLink({ url: image.download_url });
    if (result.isError) throw new Error('link_rejected');
  } catch {
    const link = element<HTMLAnchorElement>('external');
    link.href = image.download_url;
    link.hidden = false;
    element('status').textContent = '「PNGを開く」から画像を開いて保存してください。';
  }
};
element('external').onclick = (event) => {
  if (!controller.state.image || needsNewUrl(controller.state.image, Date.now())) {
    event.preventDefault();
    element('download').click();
  }
};
// タッチはブラウザのパン、マウスはドラッグ。どちらも画像全体を移動できる。
let drag: { x: number; y: number; left: number; top: number } | undefined;
viewport.onpointerdown = (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
};
viewport.onpointermove = (event) => {
  if (drag) {
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  }
};
viewport.onpointerup = viewport.onpointercancel = () => {
  drag = undefined;
};
function hostContext(context: McpUiHostContext) {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  document.documentElement.dataset.fullscreen = String(context.displayMode === 'fullscreen');
  const fullscreen = element<HTMLButtonElement>('fullscreen');
  fullscreen.hidden = !context.availableDisplayModes?.includes('fullscreen');
  fullscreen.textContent = context.displayMode === 'fullscreen' ? '会話に戻る' : '全画面';
  sizeImage();
}
element('fullscreen').onclick = async () => {
  try {
    if (!app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) return;
    const { mode } = await app.requestDisplayMode({
      mode: app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen',
    });
    hostContext({ ...app.getHostContext(), displayMode: mode });
  } catch {
    element('status').textContent = '全画面表示を使用できません。拡大操作で確認してください。';
  }
};
app.ontoolinput = ({ arguments: args }) => controller.setInput(args);
app.ontoolresult = (result) => controller.receive(result);
app.ontoolcancelled = () => controller.cancel();
app.onhostcontextchanged = () => hostContext(app.getHostContext() ?? {});
app.onerror = () =>
  controller.fail('ビューアーとの通信に失敗しました。会話で再度表示を依頼してください。');
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') controller.returned();
});
window.addEventListener('pageshow', () => controller.returned());
window.addEventListener('resize', sizeImage);
render(controller.state);
const connection = app
  .connect()
  .then(() => {
    bridgeReady = true;
    hostContext(app.getHostContext() ?? {});
    render(controller.state);
    controller.returned();
  })
  .catch(() =>
    controller.fail(
      'この環境ではビューアーへ接続できません。通常の画像取得や外部リンクを利用してください。',
    ),
  );
