# プ譜の本文取得と根拠付き生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 記事全体を参照し、根拠のない施策・条件を追加しないプ譜を生成する。

**Architecture:** 同一記事の明示的な次ページを制限付きで取得する。生成用資料を予算内で構成し、施策・八要素は資料IDと一致する原文の引用からサーバーが組み立てる。目標・勝利条件・中間目的の推測は仮説として区別する。

**Tech Stack:** TypeScript / Cloudflare Workers / R2 / Zod / Vitest / 既存ブラウザーE2E

**Spec:** 本チャットの修正方針と「新しい施策を推測で追加しない」というユーザーの訂正。

## Global Constraints

- 問い・ストックはそれぞれ1件まで。本文の複数ページは同じストックとして扱う。
- AI呼び出しは1回、system+userの本文は24,000 UTF-8バイト以内、出力上限6,000トークンを維持する。
- 入力された獲得目標・補足を保持し、空欄の目標のみ仮説として推測する。
- 施策は入力・問い・ストック本文/メモにある取り組みの原文から選び、新しい活動を生成しない。記事の事例は実行予定と区別する。
- 八要素は現在の条件として根拠のある記述のみ採用し、不明なら未確認。記事の条件はユーザーの条件に転用しない。
- 既存の保存済みプ譜を変更しない。公開・マージ・本番反映は行わない。

## Review Focus

- 次ページの外部URL・内部IPへのリダイレクト、ループ、上限超過を取得せず停止する。
- 途中ページの失敗は取得済み本文を保持し、一部取得と明示する。
- 長い本文の中間・末尾も参照し、抜粋箇所の前後を連結して偽の原文を作らない。
- AIが実在しない資料ID/引用を返したら施策を採用せず、八要素を未確認にする。
- 原文の数値・他者の活動をユーザーの資源や予定として断定しない。

### Task 1: 明示的な記事ページの取得

**Files:** `server/ingest.ts`, 必要に応じ `server/article-pages.ts`, `server/workflows.ts`, `tests/ingest.test.ts`

**Interfaces:** `fetchArticle` の title/text を保持し、複数ページ時のみ取得URLと完全性のメタデータを追加。R2 customMetadataに保持。

- [x] 次ページの本文連結・外部/内部リダイレクト拒否・ループ/ページ上限・途中失敗のテストを書き、既存実装で失敗を確認する。
- [x] rel=nextを優先し、同一originかつ同一記事のページ形式のみ取得する。最大5ページ、合計12万文字、ページ2MBの既存上限と取得時間上限を維持する。
- [x] 関連テストを実行し、本文とメタデータの保存まで検証・コミットする。

### Task 2: 根拠付き生成と本文の予算配分

**Files:** `server/pufu.ts`, `server/pufu-context.ts`, `server/pufu-create.ts`, 必要に応じ `server/pufu-grounding.ts`, `shared/pufu.ts`, `shared/locales/generation-{ja,en}.ts`, `tests/pufu*.test.ts`

**Interfaces:** 生成資料のIDと独立した本文抜粋を確定してから1回のAIに渡す。生成ドラフトの施策/八要素は `{sourceId,quote}`（施策はcolorも）を返し、サーバーが資料内一致を検証して本文・コメントを作る。

- [x] 根拠のない施策の除外・不正引用/IDの拒否・事例と入力条件の区別・長文末尾の保持・入力容量と1回呼出しのテストを先に追加し、失敗を確認する。
- [x] 本文全体から独立した抜粋を残し、目標・問い・補足を優先、重複要約を削減。メモリは背景としてのみ扱う。
- [x] ガイドラインの意味を生成ルールに反映し、未確認を許容する。根拠は既存コメントに保存し、出力JSON形式は互換にする。
- [x] 関連テストと全テストを実行し、コミットする。

### Task 3: 利用者説明・E2E・レビューとPR

**Files:** `src/UserManual.tsx`, `packages/e2e/scenarios.json`, 必要に応じ関連E2E

- [x] マニュアルへ本文の複数ページ取得・取得限界・施策の根拠と未設定の説明を反映する。E2E台帳の担当ソースと検証観点を更新する。
- [x] 型チェック・lint・format・全テスト・build・e2e:check・e2e:related --base origin/main を実行する。生成AIの意味判断そのものはモック検証で保証できないと明記する。
- [ ] 差分全体のstandard scoped security-auditと独立した同モデルのコードレビューを実施し、必要な修正・再検証・再レビューを完了する。
- [ ] 作業ブランチをpushし、mainベースのPRを作成する。

## Verification record

- Vitest: 100 files / 1,078 tests passed.
- Typecheck / lint / format / build / e2e:check passed.
- CI E2E: all seven IDs × desktop 1280×900 / phone 390×844, 14 passed; no skip/fallback/model tokens.
- Independent same-model review: initial issues fixed and final re-review found no required changes.
- Runtime model quality is not verified: AI responses are fixtures. An offline check of the supplied article's two extracted pages confirmed key second-page material in the bounded input.
- Refinements after review: maximum-input body retention, bounded R2 URL metadata, clipped sentence-edge exclusion for articles and notes.
