# メモリ差分更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 通常更新を差分化し、手動再生成で差分/全件を選択でき、反映状況を確認できるようにする。

**Architecture:** メモリごとの入力ハッシュと背景情報ハッシュをD1へ保存する。Workflowは現在の入力との比較で差分/全件を決め、メモリと履歴を最新更新番号の条件付きで原子的に保存する。APIで件数を返し既存UIへダイアログを追加する。

**Tech Stack:** TypeScript、React、Hono、Cloudflare D1 / Workflows、Vitest / Miniflare。

**Spec:** `docs/superpowers/specs/2026-10-15-incremental-memory-design.md`

## Global Constraints

- 依存は増やさない。本番デプロイ・マージは行わずPRまで。
- AIモデル・出力上限・利用枠は変更しない。
- 既存のユーザー分離、記事重複排除、更新番号による保護を維持する。
- 未完了の入力を反映済みにしない。旧データは次回の全件更新で履歴を確立する。

## Review Focus

- 並行する差分/全件要求と途中追加で、最新の入力と全件更新意図を失わない。
- 削除・移動・メモ/自己紹介変更時、古い知識を差分メモリに残さない。
- AI失敗・利用枠待ちでは既存メモリと反映履歴を保持する。
- プロジェクトとユーザーの反映履歴が独立し、別ユーザーの入力を混入しない。
- 旧スキーマのメモリと未反映0件でも、正しい選択と件数になる。

---

### Task 1: 差分生成・反映履歴・再生成API

**Files:**

- Create: `migrations/0014_incremental_memory.sql`, `server/memory.ts`, `tests/memory-updates.test.ts`
- Modify: `server/ai.ts`, `server/workflows.ts`, `server/db.ts`, `server/api.ts`, `server/env.ts`, `shared/domain.ts`, `tests/helpers.ts`

**Interfaces:**

- Produces: `MemoryCoverage` (ready_count, reflected_count, pending_count, waiting_count, full_rebuild_reason)。GET memoryのcoverage。
- Produces: POST memory/rebuildの`mode: 'incremental' | 'full'`。省略はfull。
- Produces: `updateMemory(env, current, sources, context, totals, call): Promise<MemoryData>`。totalsはarticleCountと上位30件のtopicCounts。

- [x] 既存テストを実行しベースラインを記録する。
- [x] `tests/memory-updates.test.ts` に追加分のみ・AI省略・両スコープ・削除変更・失敗/古い結果・モード/再送・移行の回帰テストを書く。
- [x] `pnpm test tests/memory-updates.test.ts` → 新機能未実装の期待値でFAILを確認する。
- [x] スキーマ、入力ハッシュ比較、差分AI生成、原子的な保存、モード受付とcoverageを実装する。
- [x] `pnpm test tests/memory-updates.test.ts tests/workflows.test.ts tests/usage-limits.test.ts tests/profile.test.ts tests/text-stocks.test.ts` → PASS。
- [x] 型チェックと関連テストを確認しTask 1をコミットする。

### Task 2: 反映状況・再生成ダイアログと全体検証

**Files:**

- Modify: `src/App.tsx`, `src/styles.css`, `README.md`

**Interfaces:**

- Consumes: Task 1のMemoryCoverageとrebuild mode。
- Produces: 通常の再生成ボタンから開く選択ダイアログ、件数表示。

- [x] ローカルブラウザで現状の再生成が直送であることを確認する。
- [x] 既存Modalを再利用し、差分/全件選択・反映件数・必要理由・送信中/エラー表示を追加する。
- [x] ドキュメントに差分処理、反映状況、全件更新が必要な条件を追記する。
- [x] ローカルブラウザでキャンセル、差分/全件の送信、未反映0件、旧履歴、キーボードと狭い画面を確認する。
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test --maxWorkers=2` / `pnpm format:check` / `pnpm build` → 全チェックPASS（ローカルのポート制約によりテスト並列数2）。
- [ ] `/review` を変更全体に実行し指摘を修正、検証・レビューを再実行する。
- [ ] コミット、push、main向けPR作成、PR添付、URLを報告する。
