# 共通コメントの実装計画

**Goal:** ストック・問い・プ譜の各局面に、本人用の時系列コメントをWebとMCPから残せるようにする。

**Architecture:** D1の共通commentsテーブルに対象種別・対象ID・局面番号・本文・作成者・日時を保存する。共通APIで所有者とMCPのプロジェクト制限を検証し、React共通欄とMCPツールから利用する。公開APIやAIメモリには含めない。

**Tech Stack:** 既存のReact / Hono / D1 / Zod / MCP。依存追加なし。

**Spec:** 保存された改善提案に基づく。自分用の時系列メモを対象とし、共同編集・通知・編集・単独削除は対象外。

## 制約と判断

- プ譜コメントは必ず実在する局面番号に紐づけ、局面切り替えで表示を切り替える。
- ストックはstocks:read/write、問いとプ譜はquestions:read/writeを利用する。
- 同じユーザーのWebと複数のMCP接続は同じ履歴を参照・追記できる。作成元（本人／AI連携）は表示用で、認可の境界に使わない。
- 追加操作はUUIDのrequest_idで再送を重複させない。
- 対象・プロジェクト・ユーザーの削除では関連コメントを削除する。
- 共通欄は古い順に50件ずつ取得し、続きの読み込みを提供する。
- 局面切り替えでは下書きと再送ID、送信中状態を局面別に保持する。送信成功時だけ該当下書きを消す。
- 独立レビュー・push・PR作成は親エージェントが担当する。

## Task 1: 保存・認可・MCP

- [x] `tests/comments.test.ts`で追加・一覧・局面分離・入力検証・再送・所有者/プロジェクト/scope制限・公開漏れ・削除を先に検証する。
- [x] 対象API/ツールが未実装のため失敗することを確認する。
- [x] `migrations/0026_comments.sql`、`shared/comments.ts`、`server/comments.ts`を追加し、`server/api.ts`と`server/mcp.ts`から共通処理を利用する。
- [x] 対象テストを実行し成功させる。

## Task 2: 共通欄・説明・検証

- [x] `tests/comments-ui.test.ts`で表示・投稿・失敗保持・局面切り替え後の古い通信の遮断を先に検証する。
- [x] `src/Comments.tsx`を追加し、`src/App.tsx`のストック詳細、`src/QuestionPage.tsx`、`src/PufuEditor.tsx`へ設置する。
- [x] `src/styles.css`とマニュアル・仕様書の該当箇所を更新する。
- [x] `pnpm check`とローカルsmokeを実行し、必要な軽微修正を行ってコミットする。

## 検証結果

- `VITEST_MAX_WORKERS=1 pnpm check`：61ファイル・648テスト、型チェック・lint・format・buildが成功。
- `SMOKE_BASE_URL=http://localhost:5174 pnpm test:smoke` と `pnpm test:smoke:mcp`：成功。
- 独立レビューで局面切り替え時の下書き・再送ID保持と、送信中に局面を往復した場合の成功結果反映を修正し、再レビューの残件なし。
- 実画面で投稿・履歴・局面別下書き復元、幅390pxのダーク表示を確認。
