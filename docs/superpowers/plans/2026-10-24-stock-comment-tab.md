# ストック詳細のコメントタブ実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ストック詳細の下部にあるコメント欄を専用タブへ移す。

**Architecture:** 既存の詳細タブに「コメント」を追加し、既存のCommentsをタブの表示領域へ移す。非選択時は非表示にしてマウントを維持し、下書き・投稿中の状態・履歴を保持する。

**Tech Stack:** React / TypeScript / Vitest / LinkeDOM。依存追加なし。

**Spec:** ユーザーの依頼と添付画像。画像の「ストックした記事」詳細を対象と解釈する。

## Global Constraints

- 通常記事・テキストのタブ順は「要約」「問い」「コメント」「メモ・保存先」「取得した本文」（テキストは「入力した本文」）。
- YouTubeは「動画」「コメント」「メモ・保存先」。
- 他タブではコメント欄を表示せず、タブ往復で下書きや送信結果を失わない。
- コメントの保存・取得API、問いとプ譜の画面、公開範囲は変更しない。
- 既存の折り返し・44pxの操作領域・テーマを使う。

## Review Focus

- 初期の要約表示と、コメント選択中のメモフォーム非表示。
- 入力途中や送信中のタブ往復で内容を失わないこと。
- 通常URL・テキスト・YouTubeで同じコメント対象を利用すること。
- スマホ幅で全タブを操作でき、横にはみ出さないこと。
- 公開ページへコメントの入口や本文を追加しないこと。

### Task 1: コメント欄の移設と利用案内

**Files:** `src/App.tsx`、`tests/short-stock-ui.test.ts`、`tests/youtube-player-ui.test.ts`、`src/UserManual.tsx`、`docs/DESIGN.md`、`docs/SPEC.md`。

**Interfaces:** 既存の`Comments({ targetType: 'stock', targetId: stock.id })`を再利用。

- [x] URL・テキストのタブ選択、他タブでの非表示、履歴表示、下書き保持と投稿を既存UIテストへ追加。YouTubeのタブ選択も更新する。
- [x] 対象テストを実行し、コメントタブがないため失敗することを確認する。
- [x] `StockDetail`にコメントタブと非表示領域を追加し、下部のコメント欄を削除する。
- [x] マニュアルと仕様・設計の該当箇所だけを更新する。
- [x] 対象テスト、`pnpm check`、ローカル画面でスマホ幅とライト・ダークのタブ切り替えを検証する。
- [x] 独立した読み取り専用レビューを実施し、必要なら修正・再検証・再レビューする。
- [ ] コミット、作業ブランチのpush、mainをベースとするPR作成を行う。

## 検証結果

- 変更前にコメントタブの未実装による3件のテスト失敗を確認し、移設後は関連26テストが成功。
- `VITEST_MAX_WORKERS=1 pnpm check`：64ファイル・679テスト、型チェック・lint・format・buildが成功。
- `pnpm test:smoke`：ローカルでの保存・要約・問い・メモリ更新が成功。
- ブラウザで375px幅のライト／ダーク表示、812px幅の横向き表示、コメント投稿とタブ往復での下書き保持を確認。タブの操作領域は44px、横にはみ出しなし。
- 独立した読み取り専用レビュー：Critical・Important・Minorの指摘なし。
- マニュアルはストック詳細のコメント入口をタブとして案内するよう更新。
