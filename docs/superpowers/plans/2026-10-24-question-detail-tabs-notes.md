# 問いの詳細タブとメモ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 問いの詳細を「本文／プ譜／コメント／メモ・保存先」の4タブにし、問いごとのメモを保存する。

**Architecture:** 既存のQuestionPage、Comments、detail-tabsの外観を再利用する。questionsにnote列を追加し、本人の問いのメモと独立した問いの保存先を更新するPATCH APIを追加する。入力フォームはタブ切り替え中も保持する。

**Tech Stack:** React 19、TypeScript、Hono、Cloudflare D1、Vitest、linkedom。

**Spec:** 本会話の依頼と訂正後の確認回答「本文／プ譜／コメント／メモ・保存先（既存コメントを残し、メモを追加）」。

## Global Constraints

- 既存のコメント・プ譜作成・お気に入り・削除機能を維持する。
- メモは2,000文字まで。空にして保存すると削除でき、公開ページとAIメモリには含めない。
- 記事に紐づく問いの保存先は記事に従う。独立した問いのみ本人の別プロジェクトに移動できる。
- ポーリングとタブ切り替えで入力中のメモやコメントを消さない。
- 作業開始点はorigin/main（36340d4）。本番反映やマージは行わない。

## Review Focus

- 保存失敗後の入力保持と再試行。
- 本人以外の問い・プロジェクトへの変更拒否。
- 記事と問いの所属不整合の拒否。
- ポーリング応答による保存内容の巻き戻り防止。
- 小画面とキーボードでの4タブ切り替え、既存のプ譜作成画面の維持。

### Task 1: メモ・保存先更新API

**Files:** `migrations/0028_question_notes.sql`, `shared/domain.ts`, `server/api.ts`, `tests/question-notes.test.ts`, `tests/question-deletion.test.ts`

**Interfaces:** PATCH `/api/v1/questions/:id` receives `{ note?: string, project_id?: string }` (one or both required), returns `{ question: QuestionDetail }`. `QuestionDetail.note: string`（メモは詳細取得時に返す）。

- [x] メモの保存・再取得・空文字削除、2,000文字上限、所有者と所属の検証、独立した問いの移動をテストする。
- [x] `pnpm test tests/question-notes.test.ts` で未実装による失敗を確認する。
- [x] 既存レコードに空文字を設定するマイグレーション、スキーマ、取得列、本人に限定した更新を実装する。更新時点の所属と記事IDを照合し、並行移動時は409とする。
- [x] 関連APIテストを実行して成功を確認する。

### Task 2: 4タブとメモ編集画面

**Files:** `src/QuestionPage.tsx`, `src/QuestionSettings.tsx`, `src/App.tsx`, `src/styles.css`, `src/UserManual.tsx`, `tests/question-page-ui.test.ts`

**Interfaces:** `QuestionPage` receives `projects` and `onUpdated`; `QuestionSettings` receives `question`, `projects`, `disabled`, `onSave({ note, project_id }): Promise<void>`。

- [x] 本文初期表示、プ譜・コメントへの切り替え、メモ保存と失敗、入力保持、キーボード移動、resolve画面維持をテストする。
- [x] `pnpm test tests/question-page-ui.test.ts` で未実装による失敗を確認する。
- [x] 既存外観を使った4タブ、メモ・保存先のフォーム、保存結果表示と競合応答の抑止を実装する。
- [x] マニュアルの問いとプ譜操作に、タブとメモの利用手順・公開範囲を反映する。
- [x] `pnpm check` 相当の全検証とブラウザでスマホ幅・ライト／ダークモードを確認する。
- [x] 独立した読み取り専用のレビューを実施し、必要な指摘を修正・再検証・再レビューする。
      完了処理：変更をコミット・pushし、mainをベースとするPRを作成する。

## 検証結果

- `pnpm test --maxWorkers=2`: 66ファイル、693件成功。既定の並列数ではOSの通信ポート不足（EADDRNOTAVAIL）が発生したため並列数を制限。
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build`: 成功。
- ブラウザ：375px幅と812px横向きで横はみ出しなし。各タブの操作領域44px、ライト／ダーク表示、メモの保存と再読み込み後の保持、マニュアルの表示を確認。
- 独立した読み取り専用レビュー：指摘なし。
