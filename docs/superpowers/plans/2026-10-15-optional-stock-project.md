# Optional stock project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ストック保存の `project_id` を任意にし、限定トークンでは限定先、省略した限定なしトークンでは所有する全プロジェクトに保存する。

**Architecture:** 保存先を解決して既存のストック・問い・メモリ更新処理を各プロジェクトに適用し、単一のD1バッチで確定する。記事本体と取得ジョブは共有する。既存の単一 `id` レスポンスとIdempotency-Keyの保存形式を維持し、全件保存では先頭の保存先のIDを返す。

**Tech Stack:** TypeScript、Hono、Zod、Cloudflare D1、Vitest/Miniflare、React。

**Spec:** このチャットのユーザー依頼（2026-10-15）：`project_id` は任意。限定トークンとの不一致はブロック。限定なしでは指定先、未指定なら全プロジェクトへ保存。

## Global Constraints

- 他ユーザーのプロジェクトに保存しない。
- 限定トークンで異なるIDを指定した場合は403。
- APIの省略時の扱いはセッション認証にも適用する。
- 空文字・nullなどの不正な指定値を省略と同一視しない。
- 保存先0件は400でプロジェクト作成を案内する。
- 保存上限は従来どおりストック件数単位。全件保存は一括成功または一括失敗。
- 同じIdempotency-Keyの再送は新たに追加されたプロジェクトに展開しない。
- 既存worktreeで実装し、デプロイや外部公開は行わない。

## Review Focus

- URL・テキスト両方で、省略・限定先・全件保存が機能すること。
- 明示的な保存先の所有権とトークン制限を維持すること。
- 既存ストックを保持し、新規保存先だけに問いとメモリ更新を作ること。
- 並行再送・プロジェクト増加後の再送で保存や利用量を重複させないこと。
- 残り保存枠が全件分に足りない場合、記事・ストック・問い・利用量が部分的に残らないこと。

### Task 1: 保存先の任意化と説明の更新

**Files:**

- Modify: `shared/domain.ts` — `stockInputSchema` の `project_id` を任意化。
- Modify: `server/api.ts` — 保存先解決、複数保存、再送と重複判定。
- Modify: `src/App.tsx` — ショートカットのJSON例と保存先説明。
- Modify: `README.md` — APIとショートカットの任意指定の説明。
- Create: `tests/stock-projects.test.ts` — 実SQLiteで保存結果・失敗時の無変更を確認。

**Interfaces:**

- Consumes: `POST /api/v1/stocks`、`stockInputSchema`、`dirtyMemoryStatements`、`queueQuestionStatements`。
- Produces: 本文の `project_id?: string`。既存の `{ id, status?, duplicate }` と202/200、403/404/400/409/429を維持。

- [x] Step 1: 省略した限定トークン・限定なしトークン・セッション、明示指定、不一致、既存ストック、保存先0件、不正値、並行再送、保存上限のテストを追加する。
- [x] Step 2: `npm test -- tests/stock-projects.test.ts` を実行し、省略が400になることによる失敗を確認する。
- [x] Step 3: スキーマと保存処理を変更し、全保存先を単一バッチに含める。request hashは指定先または限定先、全件保存ではnullを使い、既存の単一保存のハッシュを維持する。
- [x] Step 4: 同じテストがすべて成功することを確認する。
- [x] Step 5: ショートカット画面のJSON例から必須に見える `project_id` を外し、指定時と省略時の規則を画面とREADMEに記載する。
- [x] Step 6: `npm run check` と `git diff --check` を実行し、すべて成功することを確認する。
- [x] Step 7: 独立したコードレビューを依頼し、必要な修正を検証する。

## Execution notes

- ユーザーの自律実行方針に従い、この仕様のまま本セッションで実装する。
- 最新の `origin/main` を起点に `codex/optional-stock-project` を作成し、検証後にPRを作成する。
- 検証結果：`npm run check`（188件のテスト・型・lint・整形・ビルド）と `git diff --check` が成功。
- 独立レビュー：Critical/Importantなし。既存のRetry-Afterは1件分の枠回復時刻のため、全件保存ではその時刻でも枠不足の可能性がある点はMinorとして記録し、今回の修正には含めない。
