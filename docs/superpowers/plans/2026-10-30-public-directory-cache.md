# Public project directory cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開プロジェクト一覧の繰り返し取得で、公開状態の変更を取りこぼさず集計クエリを省く。

**Architecture:** `GET /api/public/projects` のJSONだけをWorkers Cache APIに60秒保存する。D1に公開一覧のrevisionを1行保存し、関連するDB変更と同じトランザクションでトリガーが更新する。各取得で最新revisionを読み、revision・ページ・設定済みoriginをキーにするため、全拠点で旧revisionを再利用しない。クライアント向けの`no-store`は維持する。

**Tech Stack:** Hono / Cloudflare Workers Cache API / D1 (SQLite) / Vitest / Miniflare。追加依存・Secret・bindingなし。

**Spec:** この計画のGoal・Architecture、および`docs/SPEC.md`「プロジェクトの公開」の既存公開範囲・停止動作。

## Global Constraints

- 変更対象は公開一覧だけ。個別の公開ページ・認証済みAPIをキャッシュしない。
- 非公開化、削除、退会、名前・紹介文・件数の変更を次回取得から反映する。
- キャッシュ障害時は現行DBから取得する。revisionの確認に失敗した場合は旧キャッシュを返さない。
- キャッシュキーは正規化済みページ、サーバー設定origin、revisionだけから作る。
- 最新`origin/main`を起点とする作業ブランチで実装し、検証・監査・独立レビュー後にPRを作成する。本番反映は行わない。

## Review Focus

- キャッシュ投入と非公開化が交差しても、遅れて保存された旧revisionを後続リクエストが使わない。
- Cookie・Authorization・任意クエリ・要求hostが共有キャッシュ内容を変えない。
- 退会の外部キー連鎖削除と、ストック・問いの所属変更でもrevisionを更新する。
- 未完成の問いと、再生成中に確定済み本文があるAIの問いの件数が正しい。
- Cache APIが利用できない環境・読み書きエラー・不正なページ指定でも既存API契約を守る。

### Task 1: revision付き公開一覧キャッシュ

**Files:** `migrations/0033_public_directory_cache.sql`, `server/public-projects.ts`, `tests/public-directory-cache.test.ts`, `tests/helpers.ts`, `docs/SPEC.md`

**Interfaces:** `public_directory_revision(id=1, revision TEXT)`をD1に追加。既存の一覧JSONとHTTPステータス・`Cache-Control: no-store`は維持する。テスト用`testApp`は実MiniflareのCacheStorageを遅延取得できるようにする。

- [x] RED: 実D1・実Cache APIで一覧を暖めた後に集計処理を失敗させても一覧を返せるテストを追加し、未実装で失敗することを確認する。
- [x] GREEN: 60秒のCache API保存とrevisionキーを追加する。公開プロジェクト、ストック、問いの追加・変更・削除でrevisionを更新するDBトリガーを追加する。
- [x] 失効、ページ分割、公開内容の隔離、キャッシュ障害、失効との競合を最小限のパラメータ化テストで保護する。
- [x] `pnpm test tests/public-directory-cache.test.ts tests/public-projects.test.ts`が全件成功することを確認する。
- [x] `docs/SPEC.md`に内部のキャッシュ方式とデプロイ前のmigration適用を記載する。基本操作と公開停止の意味は変わらないためユーザーマニュアルは更新しない。
- [x] 型チェック・lint・全テスト・format・buildを実行する。
- [ ] 最新`origin/main`との共通祖先からの全差分（未コミット・追加ファイルを含む）を`standard`のscoped security reviewと独立コードレビューにかける。必要な修正と再検証・再レビュー後にコミットする。
- [ ] 作業ブランチをpushし、`main`ベースのPRに変更内容・検証・監査範囲・未確認事項・レビュー結果を記載する。
