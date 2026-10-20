# Pufu Image Generation Implementation Plan

> Native implementation: このセッションで順に実装し、完了後に独立レビューを行う。

**Goal:** JSONから画像を生成するライブラリと自動更新、MCPでの画像参照を提供する。
**Architecture:** JSON→純粋SVG→resvg WASM→R2。D1のoutboxで更新・削除競合を回復し、取得は保存済み画像のみを返す。
**Tech Stack:** TypeScript、resvg WASM 2.6.2、Cloudflare D1/R2/Assets/Workflows、Vitest。
**Spec:** ../specs/2026-10-20-pufu-images-design.md

## Global Constraints

- Editor 0.9.15のProjectScoreModel互換。既存JSON取得と権限を維持。
- AI/ブラウザ/外部フォント通信なし。SVG/PNGを黙って切り詰めない。
- タイトル・商標表記なし。アプリの画像は進捗なし、ライブラリは切替可能。
- GET/MCP取得時に生成・保存更新を開始しない。

## Review Focus

- stale revisionの画像や古い局面を返さない（Task 2/3）。
- R2の遅延書き込みと削除が競合しても削除要求を失わない（Task 2）。
- 日本語や長文の字幅、楕円の境界、コメントの描画（Task 1）。
- 生成失敗・フォント不在・画像上限でプ譜本体を失敗させない（Task 2）。
- MCPにトークン・保存キー・他人の画像を出さない（Task 3）。

### Task 1: 画像ライブラリ

Files: packages/pufu-image/_、public/fonts/_、server/pufu-renderer.ts、vitest.config.ts、tests/pufu-image.test.ts。
Interface: `createPufuSvg(score, options)`、`renderPufuPng(score, { font, showProgress })`、ホスト初期化。

- [x] 少数・多数・長文・空・異常入力と実WASMでのPNG生成テストを追加して失敗を確認。
- [x] 試作の配置をTypeScriptへ移植し、フォントの字幅情報、上限、WASMリソース解放を実装。
- [x] フォントライセンスとパッケージREADMEを追加し、ライブラリのテスト・型・Workerビルドを確認。

### Task 2: 非同期画像の永続化

Files: migrations/0024_pufu_images.sql、server/pufu-images.ts、server/pufu.ts、server/api.ts、server/jobs.ts、tests/pufu-images.test.ts。
Interface: `syncPufuImages(env, pufuId?)`、`readPufuImage(env, principal, questionId)`。

- [x] 保存・更新・削除・遅延put・リース回復のテストを追加して失敗を確認。
- [x] エントリーの生成トリガー、再試行、遅延書き込みの削除保持を実装。
- [x] Workflow/waitUntil/Cronから呼び、プ譜保存と画像生成の失敗を分離。
- [x] 実D1/R2で競合・権限・移行の検証を行う。

### Task 3: MCP画像取得とドキュメント

Files: server/mcp.ts、server/api.ts、src/UserManual.tsx、docs/SPEC.md、README.md、tests/mcp.test.ts。

- [x] 画像取得・未作成・pending/failed・scope不足・他ユーザー/認可外プロジェクトのテストを追加。
- [x] read-only APIと `get_pufu_image(question_id)` を実装し、image contentはPNG、structuredContentはメタデータに限定。
- [x] 仕様・基本の利用案内を更新。workerdで実描画、`pnpm check`、独立レビューを完了。
- [ ] 指摘を修正し、コミット・push・mainへのPR作成と添付を行う。

## 検証記録

- ライブラリはnativeではなく実resvg WASMで検証。少数・15施策・長文・進捗切替・空・不正入力・空白保持・HMR・30回の繰り返し生成を確認。
- D1/R2で保存、局面追加、削除と遅延put、期限切れ回復、破損、入力過大、WASM障害の再試行、既存データの移行を確認。
- pnpm check（48ファイル503件）通過後、レビュー修正と追加テストを検証。最終の関連テストは53件。型・lint・format・build・依存監査も通過。
- 実workerdでJSON保存→PNG取得が少数183ms、15施策343ms、長文380ms（ローカル、初期化状況・環境に依存）。
- 独立レビューで空白保持とWASM障害再試行を修正し、再レビューで重要指摘なし。
- Ruling: 画像処理はAIのprocessing_jobsとは分離したD1 outboxを使用。API取得は生成せず、Workflow・保存後waitUntil・Cronで回復する。
