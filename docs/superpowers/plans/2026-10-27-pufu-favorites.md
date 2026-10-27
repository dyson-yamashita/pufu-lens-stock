# プ譜のお気に入り Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プ譜を一覧・詳細でお気に入り登録／解除し、お気に入りだけの一覧を表示する。

**Architecture:** ストック・問いの既存方式に合わせ、プ譜本体に個別のフラグを保存する。お気に入り更新は本文・更新番号を変更しない。星ボタンは一覧と詳細で共有し、一覧の古い取得結果が変更を上書きしないよう更新世代を比較する。

**Tech Stack:** React / TypeScript / Hono / SQLite (D1) / Vitest / linkedom

**Spec:** このチャットの「プ譜にもお気に入り機能つけてください」。既存の星ボタンとフィルターの操作を踏襲する。

## Global Constraints

- 全体一覧の表示設定・本人認可・既存のトークンとMCPの操作制限を維持する。
- 生成状態・問いとの関連の有無に関係なく登録できる。
- 本文のrevision・generation・updated_at・scoreと画像リンクを変更しない。
- 前回のアイコン変更PR #118は別ブランチに保持し、今回の差分に含めない。

## Review Focus

- 登録／解除失敗時に星の状態が変わらず、再操作できること。
- ポーリング中の登録で古い一覧が状態を戻さないこと。
- お気に入り解除後の件数とページ、およびプロジェクト変更が正しく反映されること。
- 星のクリックで詳細へ移動せず、ボタンの入れ子を作らないこと。
- 未認証・他人・トークン・MCPから許可のない更新を拒否し、公開応答へフラグを追加しないこと。

### Task 1: 保存とAPI

**Files:** `migrations/0031_pufu_favorites.sql`, `shared/pufu.ts`, `server/api.ts`, `tests/pufu-favorites.test.ts`, `tests/helpers.ts`

**Interfaces:** `PufuSummary.is_favorite: 0 | 1`; `PATCH /api/v1/pufus/:id/favorite` with `{ is_favorite: boolean }` → `{ id, is_favorite }`; `GET /api/v1/pufus?favorite=true` → 通常と同じページ形式。

- [x] 実SQLiteで未選択の初期値、登録／解除と再取得、権限・入力、非表示／ページ分割、移行の保全を検証するテストを書き、未実装で失敗を確認する。
- [x] CHECK付き列・部分インデックス・既存の認可内での更新と一覧条件を実装する。
- [x] 関連テストを実行し、旧スキーマ検証の後に現行APIを使うfixtureのみ必要な移行を追加する。

### Task 2: 一覧・詳細と案内

**Files:** `src/PufuFavoriteButton.tsx`, `src/Pufus.tsx`, `src/PufuPage.tsx`, `src/styles.css`, `src/UserManual.tsx`, `tests/pufu-list-ui.test.ts`, `tests/pufu-page-ui.test.ts`

**Interfaces:** 星の保存結果を親へ通知。プ譜一覧には「すべて／お気に入り」の押下状態付きフィルターを追加する。

- [x] 一覧の登録／解除・絞り込み・失敗・ポーリング競合と詳細での操作をDOMテストでRED→GREENにする。
- [x] 一覧カードを本文リンクと独立した星ボタンにし、既存の配色・44px操作領域を使う。
- [x] マニュアルのプ譜節に登録／解除と絞り込みの短い説明を追加する。
- [x] 全テスト（並列数2）・型・lint・format・build、ブラウザで一覧／詳細／マニュアルを確認する。
- [ ] standard scoped security-audit、独立コードレビューを完了し、必要な修正後は再検証・再レビューする。
- [ ] コミット・pushし、main向けPRを作成してURLと検証結果を報告する。
