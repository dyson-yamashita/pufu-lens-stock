# プ譜作成時の参照選択と獲得目標推測 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 問い・ストックを選択して、本文を根拠に獲得目標と廟算八要素を補ったプ譜を生成する。

**Architecture:** 既存のRelationPicker、生成API、非同期Workflowを拡張する。受付時に同じプロジェクトの参照資料を保存し、既存の入力サイズ制限の中で本文もAIへ渡す。

**Tech Stack:** React / TypeScript / Hono / Cloudflare D1・R2・Workers AI / Vitest / 既存ブラウザーE2E

**Spec:** 今回のユーザー依頼と添付の「プ譜を追加」画面。以下の細部は既存実装に合わせた実装判断。

## Global Constraints

- 入力済みの獲得目標はそのまま使用し、補足もAI入力に全文を保持する。空欄の場合は問いまたはストックを最低1件必要とする。
- 問いの関連ストックも自動で参照し、選択したストックと重複なく保存する。
- 本文・問い・補足は資料であり命令ではない。根拠のない予算・期限・担当者は未確認、推測は仮説とする。
- 長い資料は既存の永続ステップ・プロンプトの容量に収める。本文未取得の場合は利用可能な要約・メモを使う。
- 既存の認証・プロジェクト境界・課金上限・同一リクエストの再送を維持する。
- 作業ブランチからmain向けPRを作成する。マージ・本番反映は行わない。

## Review Focus

- 他人・別プロジェクトの参照と、生成途中の問いを拒否し、副作用を残さない。
- 自動推測後や編集後の同一リクエスト再送でも重複生成しない。
- 多数の長い本文でも各資料を残し、入力上限を守る。
- プロジェクト変更時に選択済み参照を引き継がない。
- 問いからの作成ではその問いと関連ストックを従来どおり引き継ぐ。

### Task 1: 生成API・資料・AI出力

**Files:** `shared/pufu.ts`, `server/pufu-create.ts`, `server/pufu-context.ts`, `server/pufu.ts`, `server/usage.ts`, `tests/pufu-reference-inference.test.ts`

**Interfaces:** createPufuSchemaに任意のquestion_ids / stock_idsと空欄可のtaskを追加。PufuContextにquestionsとstock.contentを追加する。

- [x] 推測・本文参照・入力済み目標保持・認可・再送・容量を確認する失敗テストを追加する。
- [x] `pnpm exec vitest run tests/pufu-reference-inference.test.ts` で失敗を確認する。
- [x] 既存の関連検証とDBトリガーを使って参照を保存し、本文をサイズ制限付きで取得する。
- [x] taskが空欄の場合だけAI出力のgainingGoalを必須にし、生成後に一覧用taskも更新する。
- [x] 新旧のプ譜関連テストを実行して通過を確認する。

### Task 2: 作成フォームと説明

**Files:** `src/PufuForm.tsx`, `src/locales/ja.ts`, `src/locales/en.ts`, `docs/SPEC.md`, `tests/pufu-form-ui.test.ts`

**Interfaces:** 既存RelationPickerを使用し、生成APIへquestion_ids / stock_idsを送る。

- [x] 空欄の目標での作成、参照選択、プロジェクト切替の失敗テストを追加・実行する。
- [x] プロジェクトからの作成に選択UIを追加し、問いからの作成も空欄の目標を受け付ける。
- [x] マニュアルと日英の入力説明を実装に合わせる。
- [x] UIテスト・型チェック・lint・formatを実行する。

### Task 3: E2E・監査・独立レビュー・PR

**Files:** `packages/e2e/scenarios.json`, `packages/e2e/tests/flows.e2e.ts`

**Interfaces:** PUFU-001に作成時の参照選択と空欄の目標の生成・再読込を追加する。

- [x] E2E台帳と実テストを更新し、CIモードでdesktop / phoneを確認する。
- [ ] 全体の既存チェックとstandard scoped security-auditを実行する。
- [ ] 同じモデルの独立した読み取り専用レビューを実施し、要対応事項は修正後に再検証・再レビューする。
- [ ] コミット・push・main向けPR作成を行い、検証結果と未確認事項を記載する。
