# 登録完了前のNeuron消費防止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未登録ユーザーではデモ、予約済みWorkflow、検索索引作成を含めWorkers AIを呼び出さない。

**Architecture:** DBの `users.onboarding_completed_at` を実行時の判断元にする。ジョブ配送と索引作成で未登録の所有者を除外し、共通のAI実行処理と埋め込み処理でも再確認する。AIを使わない削除処理は継続する。

**Tech Stack:** TypeScript、Cloudflare Workers/Workflows、D1、既存Vitest/Miniflare・ブラウザーE2E。

**Spec:** このチャットの依頼と `docs/SPEC.md` の初回利用登録。

## Global Constraints

- 未登録・削除済みユーザーのAI呼び出し回数は0。実AI・本番リソースで検証しない。
- 登録済みユーザーの生成・検索・使用量計測を維持し、他ユーザーの待機処理で妨げない。
- 未登録の待機処理を配送試行として数えない。既存の30分の待機期限・再試行仕様は維持する。
- 保存済みデータと検索索引削除の後処理を保持する。

## Review Focus

- 既存のAI利用予約を持つ未登録ユーザーも実行できない。
- 起動済みWorkflowとHTTP由来のフィードバック・マニュアル検索も共通実行境界で拒否する。
- 未登録の索引候補が先頭に多数存在しても登録済みの候補を処理できる。
- 削除済み所有者の索引削除は継続する。
- 登録完了後の配送・索引作成と使用量計測は正常に動作する。

### Task 1: AI実行・ジョブ配送・索引作成の登録条件

**Files:**

- Create: `server/ai-access.ts`, `tests/registered-ai.test.ts`
- Modify: `server/ai-neurons.ts`, `server/usage.ts`, `server/jobs.ts`, `server/search-ai.ts`, `server/search-index.ts`

**Interfaces:**

- Consumes: `Env.DB` と内部所有者ID、`users.onboarding_completed_at`。
- Produces: `requireRegisteredAiUser(env: Env, userId: string): Promise<void>`。未完了・ユーザー不在は拒否。

- [x] 実D1・AIスタブで、デモ初回配送0、登録前の予約済みジョブ/生成・埋め込み0、登録後の再開、索引の公平性・削除継続をテストにする。
- [x] `pnpm exec vitest run tests/registered-ai.test.ts --maxWorkers=2` で修正前の失敗を確認する。
- [x] 共通登録チェックと配送・索引のSQL条件を追加し、既存予約にもチェックを適用する。
- [x] 新規テストと生成・検索・使用量・登録の既存テストを実行して合格を確認する。

### Task 2: 仕様・E2E・最終検証・PR

**Files:**

- Modify: `docs/SPEC.md`, `packages/e2e/scenarios.json`, `packages/e2e/tests/language.e2e.ts`

**Interfaces:**

- Consumes: Task 1の登録制限。
- Produces: 初回登録前の保護と登録後の通常操作の検証記録。

- [x] LANG-001に登録前の通常API拒否・登録後の利用を確認する観点を追加する。Neuron消費0はVitestで確認する。
- [x] `maintaining-user-manual` に従い既存の登録手順と照合し、手順が同じならマニュアル更新なしと記録する。
- [x] 型チェック・lint・全Vitest・format・build・`e2e:check`・`e2e:related --base origin/main` を実行する。
- [ ] merge-baseからの全差分にquick scopedセキュリティ監査と同モデルの読み取り専用独立レビューを実施し、必要な修正を再検証・再レビューする。
- [ ] コミット・作業ブランチpush・mainベースPR作成。マージ・本番反映は行わない。
