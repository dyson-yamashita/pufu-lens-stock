# 複数の問い・ストックの関連付け Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** すべてのプ譜のメニューを追加し、カードの矢印を消し、プ譜と問い・ストック、問いとストックを複数関連付けできるようにする。

**Architecture:** 同じ所有者・プロジェクト内の関連テーブルを追加し、既存の単一関連を移行する。単一IDは既存クライアントと生成元の互換情報として残す。問いからの生成は1問を設定する。関連先の削除では残るデータを巻き込まず、公開側でも同じ関連をたどる。

**Tech Stack:** React、TypeScript、Hono、D1/SQLite、Vitest。

**Spec:** ユーザーの2026-10-27依頼と添付画面。

## Global Constraints

- プロジェクトをまたぐ関連や他人のデータへの関連は禁止。
- 既存の局面・コメント・画像リンクを移行で保持する。
- 問いから作成する場合、作成元の問い1つを設定する。
- mainへのマージと本番反映は行わない。

## Review Focus

- 既存関連・局面・コメントを保持した移行。
- 二番目以降の関連先からの閲覧、公開ページ、画像取得。
- 認可・別プロジェクトID・存在しないIDの拒否。
- リトライ時の重複防止と古いrevisionによる書き込み拒否。
- 関連先の削除・移動で共有データを消さず、プロジェクト境界を維持する。

### Task 1: データ構造とAPI

**Files:** migrations/0030_multiple_relations.sql、shared/domain.ts、shared/pufu.ts、server/relations.ts、server/api.ts、server/pufu-write.ts、server/pufu-read.ts、server/public-projects.ts、server/pufu-image-links.ts、server/mcp.ts、tests/multiple-relations.test.ts。

**Interfaces:** 詳細と一覧に `questions: {id,text,source}[]` と `stocks: {id,title}[]` を追加。問いの作成・設定に `stock_ids`、プ譜の作成・編集に `question_ids` と `stock_ids` を追加。プ譜の関連のみの更新は `PATCH /api/v1/pufus/:id/relations` に `{revision,question_ids,stock_ids}`、成功時 `{revision}`。

- [x] 関連の複数作成、更新、第二関連からの取得、認可、移行、削除・移動のテストを追加し失敗を確認。
- [x] 移行・関連取得と検証・API/MCP・公開処理を実装。
- [x] 関連するAPIテストを実行し成功を確認。

### Task 2: 画面とマニュアル

**Files:** src/App.tsx、src/Pufus.tsx、src/QuestionForm.tsx、src/QuestionSettings.tsx、src/QuestionPage.tsx、src/PufuPage.tsx、src/RelationPicker.tsx、src/UserManual.tsx、関連UIテスト。

**Interfaces:** Task 1のAPI。ページングと検索をしても選択した関連先を保持する。プ譜の関連保存後は新revisionでエディターを再読み込みする。

- [x] メニュー・矢印削除と複数選択のUIテストで失敗を確認。
- [x] 既存UIに合わせて関連選択と表示、メニュー・矢印削除を実装。
- [x] ユーザーマニュアルを最小限更新し、UIテストを実行。

### Task 3: 検証とPR

- [x] 型・lint・テスト・format・buildとローカル画面を検証。
- [x] standard scoped security-auditと独立した読み取り専用レビューを実施。指摘修正後は再検証・再レビュー。
- [x] コミット・push・main向けPRを作成し添付する。
