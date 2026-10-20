# Pufu Image Generation Implementation Plan

> Native implementation: このセッションで実装し、独立レビュー後にPRを更新する。

**Goal:** JSONからSVG/PNGを高速生成するライブラリと、リクエスト時のMCP画像取得を提供する。
**Architecture:** 認可→保存済みスナップショット→純粋SVG→resvg WASM→PNG返却。DB/R2への画像保存や自動生成は行わない。
**Tech Stack:** TypeScript、resvg WASM 2.6.2、Cloudflare D1/Assets、Vitest。
**Spec:** ../specs/2026-10-20-pufu-images-design.md

## Global Constraints

- Editor 0.9.15のProjectScoreModel互換。JSON取得と認可範囲を維持。
- AI/ブラウザ/外部フォント通信なし。本文・コメントの切り捨てなし。
- 見出し・商標表記なし。サーバーは進捗なし、ライブラリは切替可能。
- 作成・保存時の画像生成、DB/R2保存、画像生成のCron/Workflow、追加migrationを行わない。

## Review Focus

- 認可前の描画や、他ユーザー/許可範囲外のPNGを返さない。
- 描画中に更新・削除したプ譜の古いPNGを返さない。
- 日本語/長文/空白/改行/コメントを保持し、過大画像を描画前に拒否する。
- 一時障害で保存データを変えず、次のリクエストで回復する。
- MCPは1リクエスト1描画、PNGはimage contentだけに格納する。

### Task 1: 画像ライブラリ

- [x] packages/pufu-imageにスキーマ・SVG・WASM PNG生成を実装。
- [x] 字幅情報と日本語フォント・ライセンスを同梱。
- [x] 実WASMの表示・異常系・空白・HMR・リソース解放を検証。

### Task 2: リクエスト生成

- [x] generateQuestionPufuImage(env, principal, questionId)で認可・スナップショット・描画・再確認を実装。
- [x] APIとMCPから同じヘルパーを使い、DB/R2保存・自動生成・migrationを置かない。
- [x] 権限・副作用なし・保存時に描画なし・更新/削除競合・一時障害のテストを確認。

### Task 3: 検証とPR更新

- [x] マニュアル・仕様・READMEを最終動作に合わせ、実workerdで確認。
- [x] 全体チェックと独立レビュー、必要な修正を完了。
- [x] コミット・pushし、PR #79のタイトルと本文を最終仕様で更新。

## 検証結果

- `pnpm check`：型・lint・48ファイル507テスト・format・buildすべて通過。
- 実WASMの関連53テスト通過。認可前に描画しないこと、保存時の描画なし、リクエストごとの1回描画、DB/R2/AI/Workflowへの副作用なしを確認。
- 独立レビュー：関連71テストと障害関連3テスト通過。フォント取得例外を503へ変換する修正後、重要指摘なし。
- 実workerdのリクエスト開始からPNG受信完了：少数292ms、施策15件316ms、長文327ms（ローカル環境の各1回測定。初期化・実行環境で変動）。
- マニュアル：390px/1440px、ライト/ダークの4組み合わせで横はみ出し・ページエラーなし。
