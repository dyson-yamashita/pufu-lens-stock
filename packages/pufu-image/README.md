# @pufu-lens/pufu-image

Pufu Editor 0.9.19のProjectScoreModelから、DOM・ブラウザ・AIを使わずSVGとPNGを作るTypeScriptライブラリです。このリポジトリのworkspace packageとして利用します。npmへの公開は行っていません。

```ts
import { createPufuSvg, initPufuWasm, renderPufuPng } from '@pufu-lens/pufu-image';

const svg = createPufuSvg(projectScore, { showProgress: false });
await initPufuWasm(compiledWasmModule);
const { png, width, height } = renderPufuPng(projectScore, {
  font: bundledJapaneseFontBytes,
  showProgress: false,
});
```

ホストでresvg 2.6.2のWASMを初期化し、`public/fonts/pufu-jp.otf` のバイト列を渡します。字幅情報はこのフォントに対応します。Cloudflare Workersではビルド時にCompiledWasmとしてimportします。ライブラリはファイル、ネットワーク、環境変数へアクセスしません。`showProgress` の既定はtrueで、未設定の進捗を0として追加しません。入力オブジェクトは変更しません。

SVG・PNGともに `theme: 'light' | 'dark'` を指定できます。既定はlightです。darkでは背景・文字・枠線・施策やコメントの色を暗い画面向けに切り替え、文章・配置・進捗の値は維持します。アプリの通常画像と拡大モーダルは表示設定のテーマへ追従します。MCP・画像取得APIは従来どおりlightを使います。

廟算八要素は左の縦配置、コメントは色枠の吹き出しです。ブランドの見出しと商標注記は画像に含みません。長文で図形の高さを調整し、本文・コメント・順序を省略しません。公式Editorのスクリーンショットや共有施策の統合表示を再現するものではなく、各目的配下の施策をそれぞれ表示します。

不正データは `PufuImageError` にし、`code` で判別できます。Pufu Lensの保存条件と同じく本文は各1,200文字、コメントは各600文字、中間目的は12件、施策は目的ごとに12件までです。文章合計30,000 UTF-16コード単位、600万画素、PNG 2MiBが上限です。過大な画像、XML制御文字、分割不能で列幅を超える文字列は黙って切り詰めずエラーにします。PNG描画後、成功・失敗ともWASMの描画オブジェクトを `free()` します。

同じWorker isolateでは描画を逐次実行します。Pufu Lensでは認証済みの画像リクエスト時だけ生成し、画像や処理状態をDB/R2へ保存しません。ネットワークやフォント待ちを除く性能は、画像の件数・文字量・実行環境によって変わります。

フォントはNoto Sans CJK JPを日本語向けレイアウト機能と全Unicode cmapを残して軽量化したものです。ライセンス・著作権は `public/fonts/OFL.txt` に同梱しています。画像ライブラリの実装はリポジトリと同じBSD-3-Clause、resvgはMPL-2.0です。
