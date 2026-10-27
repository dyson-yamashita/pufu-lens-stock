# Pufu Guideline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCPにプ譜の意味・記述方針を返す `get_pufu_guideline` を追加する。

**Architecture:** バージョン管理する日本語の静的データを専用モジュールに保持し、既存MCPの認証・ツール登録・構造化JSON応答を再利用する。セクションと詳細度だけを引数とし、取得時に外部通信や利用者データの変更を行わない。

**Tech Stack:** TypeScript、Zod、既存MCP SDK、Vitest。

**Spec:** ユーザー添付の「Pufu Lens MCP get_pufu_guidelines 仕様案」。実装に必要な仕様を以下に記録する。

## Global Constraints

- ツール名は直接の依頼に合わせ `get_pufu_guideline`（単数形）。
- `section`: `all / principles / goals / purposes / measures / elements / review`、既定値 `all`。
- `detail`: `summary / full`、既定値 `full`。未知の引数と不正値を拒否する。
- 応答は `version: "1.0.0"`、`language: "ja"`、`section`、`detail`、`guidelines`、`sources`、原著の公式仕様そのものではない旨を含む。
- `goals` の `guidelines` は `gainingGoal` と `winCondition` を持つ。`all` は全セクションの項目を統合する。
- 要約は定義・重要な記述指針を返し、詳細は例・チェック観点・推奨作成手順も返す。
- 獲得目標と勝利条件、状態としての中間目的、仮説としての施策、現状認識としての八要素を区別する。不明情報の創作を避け、当事者の意志と変更範囲を尊重する。
- 中間目的2〜3個は推奨で、4個以上も許容。施策1〜3件はPufu Lensの目安。KPIを強制しない。
- 既存の作成・編集スキーマを機械的形式の正とする。保存・レビューの強制や自動修正は追加しない。
- 既存MCP認証内で利用でき、追加scopeは不要。書き込みのみの接続も利用可能。
- `create_pufu` / `update_pufu` とサーバーinstructionsに取得案内を追加する。

## Review Focus

- 引数省略で全項目の詳細と出典を取得できる。
- 全セクションと詳細度の組み合わせで、必要な項目を欠落・混入させない。
- 不正な列挙値・null・余分な引数を黙って既定値へ置き換えない。
- 利用者の閲覧権限なしでも静的資料だけを取得でき、未認証のアクセスは拒否する。
- 要約で例とチェックを除いても、八要素の定義と重要な指針を保持する。

### Task 1: MCPガイドライン取得と利用案内

**Files:**

- Create: `server/pufu-guideline.ts`
- Modify: `server/mcp.ts`, `tests/mcp.test.ts`, `docs/SPEC.md`, `src/UserManual.tsx`

**Interfaces:**

- Consumes: 既存 `register` / `result`、MCP OAuth、`tests/mcp-helpers.ts`。
- Produces: `pufuGuidelineSchema` と `getPufuGuideline(args)`。後者はガイドラインの構造化データを返す。

- [ ] Step 1: `tests/mcp.test.ts` に既定値、ツール宣言、全section/detail、要約の情報保持、不正入力、未認証拒否のテストを追加する。
- [ ] Step 2: `pnpm exec vitest run tests/mcp.test.ts -t ガイドライン --maxWorkers=1` を実行し、未登録による失敗を確認する。
- [ ] Step 3: 静的データと選択処理、MCP登録・案内、仕様とマニュアルの最小追記を実装する。
- [ ] Step 4: 同じテストと既存MCPテスト、型チェック・lint・format・全テスト・ビルドを実行する。実行環境由来の失敗は原因を調査し記録する。
- [ ] Step 5: 最新origin/mainとの共通祖先を基準にstandard scopedセキュリティ監査と独立した読み取り専用コードレビューを完了し、必要な修正・再検証・再レビューを行う。
- [ ] Step 6: 今回の差分だけをコミット・pushし、main向けPRに検証・監査範囲・未確認事項・レビュー結果を記載する。
