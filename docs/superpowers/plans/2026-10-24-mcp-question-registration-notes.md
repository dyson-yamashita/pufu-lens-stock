# MCP問い登録時のメモ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCPの `add_question` で、問いの登録時に任意のメモを同時保存できるようにする。

**Architecture:** 既存のMCPツールと共通登録APIを拡張し、問いとメモを同じINSERTで保存する。メモは既存のquestions.note列に格納する。登録結果にもnoteを含め、同じrequest_idの再送ではメモも比較する。

**Tech Stack:** TypeScript、Zod、Hono、Cloudflare D1、Vitest。

**Spec:** 本会話の依頼「mcpで問いの登録にメモも追加して」。

## Global Constraints

- noteは任意の文字列で最大2,000文字。省略時は空文字。改行と前後の空白を保持する。
- プロジェクト直接登録と記事に紐づく登録の両方に対応する。
- 既存のquestions:writeと保存先・所有者の認可を維持する。
- 同じrequest_idと同じ入力は同じ問いを返し、メモのみ異なる再送は409で拒否する。
- メモは公開ページとAIメモリに含めない。既存メモを編集する新規MCPツールは追加しない。

## Review Focus

- MCPのスキーマがnoteを落とさずAPIへ渡すこと。
- メモ省略・空文字で既存クライアントの再送が継続できること。
- メモ違いの再送で既存の問い・メモを上書きしないこと。
- 権限不足や範囲外プロジェクトへのメモ付き登録を拒否すること。
- 現行APIを呼ぶ旧マイグレーションテストにnote列を適用すること。

### Task 1: 登録スキーマ・保存・MCP・案内

**Files:** `shared/domain.ts`, `server/api.ts`, `server/mcp.ts`, `src/UserManual.tsx`, `docs/SPEC.md`, `tests/mcp.test.ts`, `tests/user-questions.test.ts`。

**Interfaces:** `add_question({ project_id, stock_id?, text, note?, request_id })`; POST `/api/v1/questions` accepts the optional note and returns `{ question: QuestionDetail }`。

- [x] MCP経由のメモ付き登録・取得（記事あり／なし）、上限・不正値拒否、再送の一意性・変更拒否を既存基盤でテストする。
- [x] `pnpm test tests/mcp.test.ts --maxWorkers=2 -t 'メモ付きの問い|問いの登録メモ|メモが異なる再送'` で未対応による失敗を確認する。
- [x] 任意noteをスキーマに加え、登録時に同時保存して再送で比較する。既存MCPツールに同じ引数を追加する。
- [x] メモなしの既存テストを保ち、登録結果と一覧の項目差、および旧マイグレーションテストを調整する。
- [x] マニュアルのAI連携の説明に、問いの登録時にメモを一緒に保存できることを追記する。
- [x] 関連テスト、全テスト（maxWorkers=1）、型・lint・format・ビルドを確認する。
- [x] 独立した読み取り専用レビューを行い、対応が必要な指摘があれば修正・再検証・再レビューする。

完了処理：コミット・pushし、mainベースのPRを作成する。マージと本番反映は行わない。

## 検証結果

- 追加したMCPテスト4件：未対応時に失敗を確認後、実装して成功。
- 関連テスト54件と全66ファイル・697テストが `--maxWorkers=1` で成功。並列数2ではOSの通信ポート不足（EADDRNOTAVAIL）が発生したため直列で再検証。
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build`：成功。
- 独立した読み取り専用レビュー：Critical／Important／Minorの指摘なし。
- マニュアル：AI連携から問いとメモを同時登録できることと公開範囲の説明を追加。
