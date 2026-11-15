# プフィの短いLLM会話 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「反応しません」「入力しづらいです」「その他」で、投稿内容に応じたLLMの返答を最大3往復表示する。

**Architecture:** 既存のWorkers AI呼び出し・D1会話・round 0〜2・上限・再送制御を再利用する。マニュアル検索と未解決報告は従来の処理を保つ。生成した返答はconversationへ保存し、receiptの任意のreplyで返すためDB移行は不要。

**Tech Stack:** React、Hono、Zod、Workers AI、D1、Vitest、既存ブラウザーE2E。

**Spec:** この文書内のGlobal Constraints（2026-11-14のユーザー指定）。

## Global Constraints

- 対象は「反応しません」「入力しづらいです」「その他」の3項目。
- 最初の投稿を含め最大3往復。解決・辞退・十分な整理では早く終了できる。手動終了も維持する。
- 固定質問の選択だけでなく、利用者の内容に即した短い返答・確認をLLMが生成する。
- 既存のWorkers AI、同意・認証・所有者分離・日次枠・計測・冪等性を維持する。
- 操作や修正を実行したと偽らず、根拠のない機能を案内しない。会話はプレーンテキストとして描画する。
- AI未設定・上限・生成失敗でも投稿を保持し、既存の代替案内で終了または継続する。

## Review Focus

- 応答喪失後の再送で、LLM応答とユーザー投稿を二重に保存・描画しない。
- 追加投稿なしの手動終了で、直前の質問を再表示しない。
- 最終往復と機微情報を含む場合に、追質問を継続しない。
- 旧保存データと旧receiptでも既存の固定質問による処理が動く。
- マニュアル検索・未解決ヒアリングはこの会話生成へ切り替わらない。

### Task 1: 会話API・表示・説明と検証

**Files:**

- Modify: `server/feedback.ts`, `shared/feedback.ts`, `src/PufiFeedback.tsx`, `src/locales/ja.ts`, `src/locales/en.ts`, `src/UserManual.tsx`
- Test: `tests/feedback.test.ts`, `tests/feedback-ui.test.ts`, `packages/e2e/tests/feedback-guidance.e2e.ts`, `packages/e2e/scenarios.json`, `packages/e2e/README.md`

**Interfaces:**

- Consumes: 既存のFeedbackInput、会話JSON、roundとfollow_up。
- Produces: `FeedbackReceipt.reply?: string`（保存された最終プフィ発言）。継続可否は既存follow_upのnull判定で表す。

- [x] Step 1: APIの内容依存の返答・履歴・3往復・再送・手動終了・旧会話・navigationの分離、UIの返答・継続・終了を検証する失敗テストを書く。
- [x] Step 2: `node_modules/.bin/vitest run tests/feedback.test.ts tests/feedback-ui.test.ts` で新規テストの失敗を確認する。
- [x] Step 3: 非navigationだけにreply付き構造化出力を使い、生成返答を同じ会話JSONへ保存する。次のターンには保存済みの実際の返答を渡す。UIはreplyを優先し、旧receiptの固定返答も扱う。
- [x] Step 4: 日英で3往復の相談と終了を説明し、既存E2Eに3往復表示を追加する。ブラウザーテストでは応答をfixture化し、実LLM品質と区別する。
- [x] Step 5: 関連Vitest・型・lint・format・ビルド・台帳整合性・関連E2Eを実行する。必要なsecurity-audit quick scoped runと独立コードレビュー後にコミット・push・PR作成する。

Expected: 新規のAPI/UIテストは実装前にreply不在で失敗し、実装後はすべて通る。再送でAI呼び出しは増えず、3回目の返答後は入力欄が閉じる。ブラウザーはdesktop 1280×900／phone 390×844でAI呼び出しなしのCIモードを通す。
