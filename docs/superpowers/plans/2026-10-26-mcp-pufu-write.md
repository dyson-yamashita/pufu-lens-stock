# MCPでのプ譜作成・編集と任意の問い紐付け Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** MCPから保存済みJSON形式のプ譜を作成・編集し、問いに紐付けずプロジェクトへ保存できるようにする。

**Architecture:** プ譜にproject_idを持たせ、question_idをnullableにする。既存の局面保存・競合検出を再利用し、MCPの作成・編集には新規pufus:writeスコープを要求する。問い経由の既存APIは互換性を維持する。

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1/R2, React, Vitest/Miniflare。

**Spec:** ユーザーの依頼「mcpにプ譜作成および編集を追加」「プ譜と問いの紐付けは任意」「PRは作成しない」。

## Global Constraints

- origin/main (090a8aa) からの作業ブランチを使用。PR作成・マージ・本番反映は行わない。
- MCP作成はAI生成せず、ProjectScoreModelを受け取り保存する。
- project_idは必須。question_idは作成時省略可、編集時省略で維持、nullで解除。同一プロジェクト内だけ紐付け可。
- 作成はrequest_idで再送を検出し、編集はrevision必須。本文上限256KiBを維持する。
- 既存の問いの削除に伴う紐付いたプ譜の削除動作は維持する。

## Review Focus

- 移行時に既存のプ譜・局面・コメント・期限付き画像リンクが失われないこと。
- 他人・許可外プロジェクト・不一致の問いを閲覧/編集/紐付けできないこと。
- 同じrequest_idの再送と異なる内容の再使用、古いrevisionの編集を安全に処理すること。
- 問いなしのプ譜を一覧・詳細・画像・ビューアー・コメントで扱えること。
- 問いのプロジェクト移動時もプ譜の保存先と認可が追随すること。

### Task 1: 保存・MCP・既存画面の統合

**Files:** migrations/0029_independent_pufus.sql, shared/pufu.ts, shared/mcp.ts, shared/pufu-viewer.ts, server/api.ts, server/mcp.ts, server/pufu-read.ts, server/pufu-images.ts, server/pufu-image-links.ts, server/comments.ts, src/PufuPage.tsx, src/Pufus.tsx, src/App.tsx, src/mcp-pufu-viewer/controller.ts, src/UserManual.tsx, docs/SPEC.md, tests/mcp.test.ts, tests/independent-pufus.test.ts, tests/pufu-viewer-controller.test.ts。

- [x] 既存テストの基準結果を確認する。
- [x] API/MCP経由の独立プ譜・作成再送・編集競合・認可の失敗テストを追加し、未実装で失敗することを確認する。
- [x] データ保全を含むマイグレーションとAPI、MCPツールを実装する。
- [x] 問いなしプ譜の取得・画像・コメント・画面表示を整合させる。
- [x] マニュアルと仕様を更新する。
- [x] 関連テスト、全テスト、型チェック、lint、format、buildを実行する。
- [x] 独立エージェントによる読み取り専用レビューを行い、必要な修正と再検証を完了する。
- [x] コミット・pushして結果を報告する。PRは作成しない。

**Verification:** `pnpm typecheck`・`pnpm lint`・`pnpm format:check`・`pnpm build`・`pnpm test --maxWorkers=1`。すべて成功（68ファイル・715テスト）。既定の並列度ではworkerdの接続エラーが発生したため、テストはworkerを1つに制限して実行した。

**Review:** 独立エージェントが変更全体をレビュー。紐付け変更後のビューアー再取得と独立プ譜の戻り先を回帰テストで再現して修正し、再レビュー完了。未解決の指摘なし。移行はD1の統合テストに加え、レビュー担当がSQLiteでも全値保全・旧INSERT・問い移動・削除連鎖・外部キー整合性を検証した。

**Manual:** MCPでの作成・編集、問いへの任意の紐付け、追加権限の再認可と公開範囲の説明を更新した。
