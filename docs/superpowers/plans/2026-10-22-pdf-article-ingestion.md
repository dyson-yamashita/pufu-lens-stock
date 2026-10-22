# PDF記事の自動取得 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDFの公開URLをストックすると、本文とタイトルを抽出して既存の要約・問い・メモリ処理へ渡す。

**Architecture:** 既存の検証付きHTTP取得を共用し、Content-TypeがPDFならWorkers対応のunpdf（Mozilla PDF.js）で解析する。日本語などの文字対応表はpdfjs-distから静的資産へ同梱し、ASSETS経由で読み込む。本文は既存のR2保存・Workflowへ返す。新規APIやDB変更は不要。

**Tech Stack:** TypeScript、unpdf、Cloudflare Workers / Workflows、Vitest / Miniflare。

**Spec:** このチャットの依頼「PDFの記事も自動取得できるように対応して」。既存の取得制約は `docs/SPEC.md` の「記事取得の範囲」。

## Global Constraints

- 最新のorigin/mainから作成した `codex/pdf-article-ingestion` で作業する。
- URL・DNS・リダイレクトの検証とCookie/Bearerの非転送を維持する。
- HTML/テキストは2MB、PDFは10MB・100ページ、抽出本文は12万文字を上限とする（今回の実装判断）。
- 文字情報のあるPDFを対象とし、OCR・パスワード解除は追加しない。読み取れないPDFは本文補完を案内する。
- PDFの外部資源取得・JavaScript実行を行わず、読み取り後は解析資源を破棄する。
- マージ・本番デプロイは実施しない。

## Review Focus

- 日本語・複数ページ・メタデータなしのPDFでも本文と有用なタイトルを返す。
- Content-Lengthがない/過少でもストリームの実バイト数で上限を守る。
- 壊れたPDF・文字のないPDF・暗号化PDFは利用者に理由を伝える。
- ページ数と本文量の超過は要約前に止める。
- Workersの制約下で実際のJ-STAGE PDFを読み取り、HTMLと既存Workflowに回帰を生まない。

### Task 1: PDF取得・既存Workflowへの接続と案内

**Files:**

- Create: `server/pdf.ts`、`tests/pdf-fixture.ts`、`scripts/pdf-cmaps-plugin.ts`
- Modify: `server/ingest.ts`、`tests/ingest.test.ts`、`tests/workflows.test.ts`、`package.json`、`pnpm-lock.yaml`、`src/UserManual.tsx`、`docs/SPEC.md`、`vite.config.ts`

**Interfaces:**

- Consumes: `fetchPublic(value)` の検証済みResponseと最終URL。
- Produces: `extractPdf(data: Uint8Array, url: URL, assets?: Fetcher): Promise<{ title: string; text: string }>`。既存の `fetchArticle` と同じ戻り値。

- [x] 既存の取得・Workflowテストを実行し、開始時点の成功を確認する。
- [x] 実PDFを使う取得成功・タイトル代替・容量/ページ/本文上限・読取不可、およびPDF再試行後のR2保存/要約完了テストを追加する。
- [x] `pnpm test tests/ingest.test.ts tests/workflows.test.ts` を実行し、新規テストがPDF未対応で失敗することを確認する。
- [x] unpdfを追加し、PDFをバイト列として上限付きで取得・解析する。タイトルはメタデータ、先頭の本文行、ホスト名の順に選ぶ。
- [x] 同じテストを実行し、成功を確認する。マニュアルと仕様の取得範囲・本文補完の案内を更新する。
- [x] 全体テスト・型チェック・lint・整形・ビルドと実J-STAGE PDFのローカルWorkers確認を行う。期待結果は全チェック成功・日本語本文抽出成功。
- [x] 独立した担当者による読み取り専用レビューを実施し、必要な修正・再検証・再レビューを完了する。

完了工程として、変更をコミット・pushし、mainをベースにPRを作成する。

## 検証結果

- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build` が成功。
- `pnpm test --maxWorkers=2`：53ファイル・592テストが成功。既定並列数での再実行時にローカルRPCの起動・接続エラーが発生したため並列数を制限して確認した。
- J-STAGEの対象PDFをローカルの通常保存APIから取得し、日本語本文8,236文字をR2へ保存、要約完了まで確認（AIはローカルデモの代替処理）。
- ToUnicodeを持たない日本語PDFをローカルWorkersで解析し、同梱CMapをASSETSから読み込んで329文字を抽出。
- 独立レビューのCMap・Acceptの指摘を回帰テストで再現して修正。再レビューで残存指摘なし。
- npm registryの監査APIがタイムアウトしたため、依存監査の結果は未取得。
