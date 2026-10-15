# AI処理の同時数と再試行期限の変更

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同時AIジョブ・呼び出しを各5件、試行を10回、待機を30分までにする。

**Architecture:** D1にジョブごとの起動試行数を永続化し、dispatcherが枠確認・起動を原子的に取得する。待機中のジョブは受付から30分または10試行で失敗に移し、Workflow内の枠待ちにも同じ停止処理を使う。既存のジョブテーブルを作り直す旧マイグレーションと独立させるため、試行数は専用テーブルに保存する。

**Tech Stack:** TypeScript、Cloudflare Workflows/D1、Vitest/Miniflare。

**Spec:** このチャットのユーザー依頼（同時5、試行10、待機30分）。

## Global Constraints

- 同時受付ジョブと実AI呼び出しの既定値は各5。既存の環境変数による上書きは維持する。
- AIステップは初回を含め最大10試行。通信結果が不明な呼び出しの自動再発行禁止と完了結果の再利用を維持する。
- ジョブの枠確認・起動も初回を含め最大10試行。待機期限は受付から30分とし、実行中の処理は期限だけで中断しない。
- 回数または期限を超えた待機は理由を表示して失敗に移す。新しい明示的な再試行は新規ジョブとして扱う。
- 日次上限は変更しない。本番デプロイやマージは今回の作業に含めない。

## Review Focus

- 未来の再試行日時でも30分で停止すること。
- 並行dispatcherが同じ起動試行を二重計上せず、古いCron回復が新しい実行を上書きしないこと。
- 10回目は実行でき、11回目は起動・AI呼び出しとも発生しないこと。
- Workflow内での保留、起動失敗、cleanup回復にも停止条件が適用されること。
- 旧DBからの移行、失敗表示、実行中ジョブの保護が維持されること。

### Task 1: 同時数・試行数・待機期限をまとめて制御する

**Files:**

- Create: `migrations/0014_job_retry_limits.sql`, `server/job-retries.ts`, `tests/job-retry-limits.test.ts`
- Modify: `server/jobs.ts`, `server/usage.ts`, `server/workflows.ts`, `server/db.ts`, `server/env.ts`, `tests/helpers.ts`, `tests/usage-limits.test.ts`, `README.md`

**Interfaces:**

- Consumes: `Job`, `jobFailureStatements(env, job, message)`, 既存D1/Workflowバインディング。
- Produces: `MAX_ATTEMPTS = 10`, `MAX_WAIT_MS = 1800000`, `stopWaitingJob(env, job): Promise<boolean>`, `deferJob(env, job, retryAt, message): Promise<boolean>`。

- [ ] 同時5件の受付と6件目の拒否、AI最大10試行、ジョブ最大10試行、30分境界・未来の保留・Workflow内保留・並行起動のテストを先に追加し、未実装による失敗を確認する。
- [ ] 最小限のDB移行と共通停止処理を実装し、AIの再試行間隔が30分を超えないよう5秒の固定間隔にする。
- [ ] 対象テストを通し、READMEの既定値・停止条件・移行手順を更新する。
- [ ] `pnpm run check` を実行し、全検証が成功することを確認する。
- [ ] 全差分に `codex review --base origin/main`（`/review` 相当）を実行し、必要な修正・再検証・再レビューを行う。
- [ ] コミット、作業ブランチのpush、main向けPR作成と添付、URL報告を行う。
