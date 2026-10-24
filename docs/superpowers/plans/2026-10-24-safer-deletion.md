# 削除操作の誤操作防止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存・更新・解決へ進む操作から削除を分離し、対象と影響を確認してから削除できるようにする。

**Architecture:** 共通の `DeleteAction` が閉じた操作欄と確認ダイアログを提供する。各画面は既存の削除APIと完了処理を渡し、データの削除範囲は変更しない。

**Tech Stack:** React 19、TypeScript、HTML details/dialog、既存CSS、Vitest・LinkeDOM。

**Spec:** この会話で承認された改善案。プロジェクト・X設定は下部の折りたたみ、ストック・問い詳細は「その他の操作」に削除を移す。確認には対象名・削除範囲を示し、初期フォーカスをキャンセルにする。

## Global Constraints

- 最新の `origin/main` から作業ブランチを作成し、既存の自動生成設定を保持する。
- 新しい依存、API変更、復元機能、本番反映は含めない。
- 削除確認は既存の `dialog` と同じ表示方式にし、処理中は確定・キャンセルを無効にする。
- 日常操作と削除を同じ操作行に置かず、閉じた削除欄を区切り線と余白で分離する。
- レビュー・検証後にブランチをpushして `main` 向けPRを作る。マージしない。

## Review Focus

- 未保存のプロジェクト名・保存先があっても、確認は保存済みの削除対象を示す。
- 生成待ちで本文のない問いも、削除対象と削除範囲を説明できる。
- ストックの親ダイアログ内でも削除確認にフォーカスが入り、キャンセル後に操作へ戻れる。
- 削除失敗で編集内容を失わず、再試行できる。処理中の連打・Escapeで重複送信しない。
- モバイル・ダークモード・長い対象名でも保存と削除が混在せず、内容を読める。

### Task 1: 4画面の削除操作と確認を共通化する

**Files:**

- Create: `src/DeleteAction.tsx`
- Modify: `src/App.tsx`, `src/QuestionPage.tsx`, `src/XIntegration.tsx`, `src/styles.css`
- Modify: `src/UserManual.tsx`, `docs/DESIGN.md`
- Test: `tests/deletion-ui.test.ts`

**Interfaces:**

- Consumes: 各画面の既存削除API、完了コールバック、保存中フラグ。
- Produces: `DeleteAction({ summary?: string, label: string, title: string, children: ReactNode, disabled?: boolean, onDelete: () => Promise<void> })`。childrenは確認画面の対象・影響説明。成功後は確認を閉じ、失敗は確認内に表示する。

- [x] **Step 1: 既存UIテスト基盤で削除の安全性をテストする**
      4画面で削除が閉じた操作欄にあり、フォーム外から確認を開き、キャンセルでは送信せず、確定後だけ対象のDELETEを一度送ることを検証する。X連携で失敗・再試行・処理中の連打を検証し、ストックのメモはキャンセル後も保持する。
- [x] **Step 2: REDを確認する**
      Run: `pnpm exec vitest run tests/deletion-ui.test.ts`
      Expected: 新しい操作欄・確認がないためFAIL。
- [x] **Step 3: 共通コンポーネントと4画面を実装する**
      `DeleteAction` 内で確認状態・エラー・処理中を管理し、in-flight参照で重複を防ぐ。detailsは初期状態で閉じ、dialogはキャンセルを初期フォーカスにする。プロジェクトの削除欄は公開設定より下に配置する。対象名は保存済みの値を使う。問いの既存削除ダイアログは共通部品へ置換する。
- [x] **Step 4: GREENと文書整合を確認する**
      Run: `pnpm exec vitest run tests/deletion-ui.test.ts`
      Expected: 全件PASS。
      マニュアルに変更した入口と削除範囲を短く追記し、デザイン仕様を現行UIへ合わせる。
- [x] **Step 5: 全体検証・画面確認・コミット**
      Run: `pnpm run check`
      Expected: 型・lint・全テスト・format・buildが成功する。
      ローカルデモで4画面、スマホ相当幅、ダークモード、マニュアル、フォーカスとEscapeを確認する。
      検証済み差分をコミットし、独立した読み取り専用レビュー後にpush・PR作成する。
