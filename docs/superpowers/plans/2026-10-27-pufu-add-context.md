# プ譜一覧からの追加と補足入力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** プ譜一覧に「プ譜を追加」を設け、一覧と問いの両方から獲得目標と任意の「廟算八要素・取り組む予定の施策」を入力して生成できる。

**Architecture:** 既存の問いからの生成フォームを共通化し、一覧ではプロジェクト選択付きのダイアログに表示する。生成受付を共通関数にまとめ、問いなしの場合も既存のジョブ・利用制限・スナップショット保存を利用する。補足は `details` として保存し、AIへ資料として渡す。

**Tech Stack:** React / TypeScript / Hono / Zod / D1 / Vitest / linkedom

**Spec:** この依頼の3要件（一覧の追加ボタン、獲得目標以外の自由記入欄、問いからも同じ欄）。任意欄は4,000文字、一覧からは問いを紐付けず、保存先は選択中のプロジェクトを初期値にする。これは既存実装に合わせた実装判断。

## Global Constraints

- 既存デザイン・生成済みJSON保存API・利用制限を維持し、DB移行や依存追加はしない。
- 獲得目標は1,000文字。補足の空欄は許容し、既存の保存済みcontextも読み込める。
- 未コミット変更は作業開始時点でなし。最新origin/main b840ac8を起点とする。

## Review Focus

- 補足だけ変更して再送した場合は新しいrequest_idにする。同一IDの異なる補足は409。
- 他人のプロジェクトとトークンの範囲外には生成できない。
- 問いなしでも生成ジョブ・一覧表示・戻る操作が成立する。
- 補足未入力・4,000文字超過と旧contextを扱える。
- 二重送信でジョブや利用枠を重複させない。

### Task 1: 一覧と問いから共通の補足付きプ譜生成

**Files:** `shared/pufu.ts`, `server/pufu.ts`, `server/api.ts`, 新規 `server/pufu-create.ts`, 新規 `src/PufuForm.tsx`, `src/QuestionPage.tsx`, `src/Pufus.tsx`, `src/App.tsx`, `src/UserManual.tsx`, `docs/SPEC.md`, `docs/DESIGN.md`, `tests/pufu.test.ts`, `tests/pufu-list-ui.test.ts`, `tests/question-page-ui.test.ts`

**Interfaces:** `createPufuSchema` は `details?: string` を受け、`PufuContext.details?: string` を保存。`POST /api/v1/projects/:id/pufus/generate` は問いなし生成、既存 `POST /api/v1/questions/:id/pufus` は問い付き生成を共通受付処理へ渡す。成功時 `{id,status}` を返す。

- [x] 既存Vitest基盤で、一覧と問いからの補足送信・再試行ID、スナップショット・AI入力、所有権・文字数・再送競合の失敗テストを追加する。
- [x] 関連テストを実行し、新機能の不在による失敗を確認する。
- [x] 共通受付・フォームと追加ボタンを実装し、マニュアルと仕様を更新する。
- [x] 関連テスト、型チェック、lint、format、全テスト、ビルド、ローカル画面確認を実施する。期待値は成功。
- [ ] standard scoped security-auditと独立した読み取り専用コードレビューを行い、必要な修正と再確認を終える。
- [ ] 差分をコミット・pushし、main向けPRを作成する（マージしない）。
