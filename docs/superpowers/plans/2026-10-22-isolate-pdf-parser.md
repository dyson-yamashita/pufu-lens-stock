# PDF解析の隔離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 正常・異常を問わず全PDFの解析をアプリ本体から分離し、PDF側のメモリ・CPU超過をURLを維持した取り込み失敗として扱う。

**Architecture:** 公開エンドポイントのないPDF専用Workerへ、検証済みの取得バイト列だけをサービスバインディングで渡す。専用Workerは既存unpdfと同梱CMapで解析し、本体には抽出結果だけを返す。専用Workerの128MB/isolateというプラットフォーム制限を利用し、CPU上限も設定する。DB・R2・認証情報・外部URL取得機能は解析Workerへ渡さない。

**Tech Stack:** TypeScript、Cloudflare Workers service bindings、Vite auxiliary Workers、unpdf、Vitest / Miniflare。

**Spec:** このチャットで合意した全PDFの隔離、および依頼「修正もお願いします」。受付上限の検討は調査PR #97（別PR）を参照。

## Global Constraints

- 最新origin/main (`a9b3bae`) から `codex/isolate-pdf-parser` を作成済み。
- PDFは10MiB・100ページ・12万文字、解析待機20秒を維持する。
- PDF専用Workerはworkers.dev・preview URL・公開ルートを持たず、DB/R2/AI/OAuth等のバインディングを持たない。
- 解析WorkerのCPU上限は5,000ms。メモリはCloudflareの128MB/isolate制限を利用し、アプリ側へのフォールバック解析を作らない。
- 資源超過・接続失敗・解析失敗時は既存Workflowの失敗記録を利用し、URLを残して本文補完を案内する。
- 本番デプロイ・マージは行わない。デプロイ手順だけを追加し、専用Workerを先に配置する。
- 一般ユーザーの操作・受付数値は変わらず、マニュアルは影響を判断して必要な場合のみ更新する。

## Review Focus

- サービス未設定・資源超過が本体内でのunpdf解析にフォールバックしない。
- 正常な日本語・複数ページPDFがサービス越しでも従来どおり取得できる。
- 失敗時にURLを残し、R2本文や要約を誤って保存しない。別の記事の通常取得は継続できる。
- 本体ビルドにunpdf/PDF.jsが含まれず、専用Workerのみに配置される。
- ローカル開発・本番ビルド・CIデプロイのバインディングとCMap資源が一致する。CMapライセンスを生成バンドルに保持する。

### Task 1: 隔離境界と取り込み処理

**Files:** `server/pdf.ts`、`server/pdf-worker.ts`、`server/pdf-client.ts`、`server/ingest.ts`、`server/env.ts`、サイズ制限付き読み込みの共通ファイル、`tests/ingest.test.ts`、`tests/pdf-worker.test.ts`、`tests/workflows.test.ts`、PDF Workerのテストヘルパー。

**Interfaces:** `parsePdf(env, source: Response, url: URL): Promise<{title: string; text: string}>` がサービスへPOSTする。専用WorkerはJSONの `{title,text}` または422の `{error}` を返す。ランタイム例外・5xx・不正応答は本体で本文補完を案内する一般エラーにする。

- [x] サービス未設定・例外・5xxの拒否、PDF本文の転送、Workflowの失敗状態とURL保持をテストで再現し、未修正で失敗を確認する。
- [x] 取得済みの応答本文をストリームで転送するクライアントと、入力サイズ制限・既存解析・理由付き応答を持つ専用Workerを実装する。
- [x] ページ文字情報を順次読み、本文12万文字で早期停止する。これを展開量制限とは扱わない。
- [x] 実Miniflare Worker経由で既存PDF取得とWorkflowテストを通し、異常終了後の別取得を確認する。

### Task 2: 構成・デプロイ・完了検証

**Files:** `wrangler.pdf.jsonc`、`wrangler.jsonc`、`vite.config.ts`、CMapビルド処理、`package.json`、`.github/workflows/cloudflare-deploy.yml`、`docs/SPEC.md`。

- [x] PDF専用Worker、主WorkerのPDF_PARSERサービス、ローカルViteのauxiliary Worker、同梱CMapを接続する。
- [x] 通常/本番ビルドで専用Workerが出力され、本体へPDF.jsが含まれないことを確認する。専用Worker→本体のデプロイ順にCLI/CIを更新する。
- [x] 型チェック・lint・整形・全体テスト・ビルド・本番設定dry-runを実行する。ローカルの資源制限では本番OOMを保証できないことを報告する。
- [x] 仕様・構成を更新し、マニュアル影響を判断する。
- [x] requesting-code-reviewの独立レビュー、必要な修正と再レビューを完了する。

検証・レビュー完了後、この作業ブランチをコミット・pushし、main向けPRを作成する。

## 実行判断

- 既存作業場所は管理されたworktreeのためそのまま利用する。
- ユーザーの自律実行方針に従い、計画の再承認や通常工程の許可確認を挟まず、このセッションで実装する。
- 静的な専用Workerを選ぶ。Dynamic Workersの作成数課金や動的コードロードを追加せず、既存Vite/Cloudflareデプロイへ統合するため。
