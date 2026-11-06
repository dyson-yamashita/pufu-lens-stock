# 勝利条件の内容保持と独立検証 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in this session.

**Goal:** 中間目的・八要素から統合した勝利条件が定型文へ失われる問題と、事例の入力欠落を修正する。

**Architecture:** 事実抽出→目標/目的→勝利条件→独立検証の通常4呼び出し。検証は最終整形後の文を評価する。意味の不合格は結果としてキャッシュし、理由を渡した勝利条件の再生成と再検証を各1回だけ行う（通常の通信/形式エラー再試行は既存上限に従う）。

**Tech Stack:** TypeScript, Zod, Cloudflare Workflows/D1, Vitest.

**Spec:** 本会話の原因調査・具体的修正案・費用説明に対する「修正お願いします」。

## Global Constraints

- 作品名を含む回帰テストは一般名称にする。添付や本番の文章をテストへ転載しない。
- 保存済みデータと表示形式を維持し、mainへの直接commit/push・マージ・本番反映を行わない。
- 正常時4回、意味の再生成は1回まで（計6回）。成功済み段階を再送せず、利用枠・削除・世代・プライバシーguardを全段階に適用する。
- 行動なしは最終2段階を省略、デモは追加AIなし。日本語60字/英語140字・一文、各構成入力24KBを維持する。
- 八要素は表示する最終内容と一致させる。対象付き事例は共通要件にせず、独自計画へ転用しない。
- 不合格の文を汎用文に置き換えて成功保存しない。目的/品質の既存補正は今回の範囲では維持する。

## Review Focus

- 「利用できる」という正当な成果を語句だけで消さない。未承認/未検証の保証は独立検証で拒否する。
- 全目的/八要素のJSONが揃っていても最終文が無関係なら受理しない。
- 検証前後の利用枠不足と修正後の再開で、検証対象の文が変化しない。
- 第二の検証も不合格なら保存せず終了し、Workflow再実行でも意味の再生成回数を増やさない。
- 検証の短い理由はscoreや公開画面に入れず、推論文や原文をログに出さない。

## Tasks

### Task 1: 再現テストと入力・補正の修正

**Files:** `server/pufu-output.ts`, `server/pufu-win.ts`, `tests/pufu-win-review.test.ts`, `tests/pufu-case-context.test.ts`.

- [x] 語句の誤検知で最終文が消える回帰と、対象付きの品質/素材事例が最終入力にあることをREDで確認。
- [x] winだけの全文fallbackを除去。`pufuWinInput(context,facts,score)`で最終elementsと対象/時制付き事例を組み立て、生成・検証で共有する。
- [x] 同じ回帰をGREENで確認。

### Task 2: 独立検証と上限付き修正

**Files:** `server/pufu-win-review.ts`（新規）, `server/pufu.ts`, `server/pufu-win.ts`, `tests/pufu-win-review.test.ts`, `tests/pufu-stage-resume.test.ts`, `tests/pufu-ai-fixture.ts`.

**Interfaces:** `reviewPufuWin(env,context,facts,score,language): Promise<{ winCondition: string; issues: string[] }>`。全目的の統合、八要素の尊重、根拠、全体の成就を別呼び出しで判定。失敗理由は最大3件/各160字。検証対象文はサーバーが付与しcacheとの一致を確認する。`integratePufuWin`は任意の修正入力（前案/理由）を受け取る。

- [x] 正常4回、意味の拒否→修正6回、再拒否で保存なし、検証の欠落/不正応答、上限到達後のcache再開をREDで確認。
- [x] 新しい安定した段階名で生成・検証・修正を分ける。旧統合cacheを使わず、目的cacheは利用する。検証後の勝利条件変更は保存前に拒否する。
- [x] fixtureと既存計数テストを4段階へ更新。語句補正の旧テストは目的/品質の補正と独立検証の拒否に分けて維持する。

### Task 3: 説明・実モデル・全体検証とレビュー

**Files:** `README.md`, `docs/SPEC.md`, `src/locales/{ja,en}.ts`, `packages/e2e/scenarios.json`.

- [x] 手引きの利用枠説明を通常4回・意味の再生成は1回までへ更新。E2E台帳の担当ソース/確認事項を更新。
- [x] 一般名称の修復資料、責任者判断を要する試行、英語の3例を実モデルで確認。生成文・整形後・検証対象・保存文の一致を照合する。
- [x] 型/lint/format/build/全Vitest/E2E台帳と関連E2Eを実行し、制約は未確認として記録。
- [ ] 同モデル独立コードレビューとstandard scoped security-auditを完了し、必要な修正・再検証後にcommit/push/main向けPR作成、CIを確認。

## Decisions and Evidence

- 調査資料: `/workspace/artifacts/pufu-win-investigation-2026-11-06/`。元AI応答は未保持だが、全段階cacheと添付一致、語句fallbackによる同じ症状を再現済み。
- Ruling: 使用言語・回数の説明と独立検証を含む前案をユーザーが承認したため、追加の承認待ちは設けずこのセッションで実装する。

- 原資料の留保が抽出から落ちた場合も検証へ届くよう、既存generationInput/prepareEvidenceInputを24KBの残枠で使用。本文・メモ・プロジェクト説明の回帰をRED→GREENで確認。
- 実モデル8判定: 日2/英1・正当な利用・修正後を承認、汎用文/試行から本運用への拡大/本文だけの利用可未確認を拒否。修復例を4段階へ再生し最終リクエストとscore保持も照合。
- 独立レビューで原資料の留保が欠落するImportantを修正し、再レビューで対応必須指摘なし。関連73件を独立実行してPASS。
- 検証側が目的自体の文体を採点した実モデルの誤判定を確認し、最終winConditionのみを評価するよう明確化して同例を再検証。AI判定は完全保証ではなく、指摘が過剰になる場合は残る。

- 最終108ファイル/1,222テストPASS（maxWorkers=2）。型・lint・format・build・E2E台帳は成功。ローカル関連E2Eは公式Chromium取得先403で起動前に停止し、CIで確認する。
