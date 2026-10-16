# サーバ側Qwen OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 画像OCRをブラウザー内TesseractからWorkers AIの画像対応Qwenへ移し、既存と同様の永続的な利用上限を適用してPRを作成する。

**Architecture:** 認証済みWebユーザーが画像バイナリーをPOSTし、サーバーで形式・サイズ・画素数を検証してOCRする。画像は推論時のみCloudflareへ渡し、永続保存しない。既存のai_operations / ai_calls / ai_attemptsを使い、OCR結果の再送・並行呼び出し・日次上限をD1で制御する。抽出本文はフォームで確認してから従来の保存APIへ渡す。

**Tech Stack:** Cloudflare Workers AI / D1、Hono、React、Vitest、image-size。

**Spec:** 本チャットの合意（Qwenによるサーバ側OCR、利用上限、修正PR）とREADMEの既存OCR・利用上限仕様。

## Global Constraints

- 最新origin/main起点の作業ブランチを使い、PR作成前に `/review` を実行する。
- OCR_MODEL既定値は `@cf/qwen/qwen3.8-27b`。要約用AI_MODELを変更しない。
- AI_OCR_DAILY_LIMIT既定値はユーザーごと直近24時間50回。失敗も計上する。
- 既存AI_CALL_DAILY_LIMIT（500回）とAI_CONCURRENT_CALLS（5件）にも計上する。
- PNG/JPEG/WebP、10MiB・2,000万画素以下。出力最大8,192トークン・本文20,000文字、思考モードは無効。
- OCR APIは同一OriginのWebセッション専用。APIトークン・MCPには追加権限を付与しない。
- 同じUUID・同じ画像の再送は再推論せず、異なる画像の再利用は409。通信エラーの自動再推論なし。

## Review Focus

- 同一IDの並行再送と別IDの並行要求でも上限超過や二重課金を生じない。
- OCRと既存Workflowが実呼び出し総数・同時枠を共有する。
- 偽装MIME・巨大画像・不正画像をAI呼び出し前に拒否する。
- エラー時もフォームを解除し、途中で離れた画面へ古い結果を反映しない。
- Worker中断時の実行中レコードが永久に枠を占有せず、完了済み結果だけ再利用する。

### Task 1: サーバ側OCRと永続的な利用制限

**Files:** `server/ocr.ts`, `server/env.ts`, `server/api.ts`, `server/usage.ts`, `server/jobs.ts`, `migrations/0018_ocr_calls.sql`, `tests/server-ocr.test.ts`, `package.json`, `pnpm-lock.yaml`

**Interfaces:** `POST /api/v1/ocr` はContent-Typeに画像形式、Idempotency-KeyにUUID、bodyに画像を受け、`{text,model}` を返す。上限時は429・Retry-After・retry_at。

- [x] 成功・形式検証・認証・上限・並行再送・失敗・中断回復のテストを書いて失敗を確認する。
- [x] OCR処理・AI入力型・D1利用枠と結果再利用・Cron回復を実装する。
- [x] `pnpm test tests/server-ocr.test.ts tests/usage-limits.test.ts` を実行して成功を確認する。

### Task 2: OCRフォームの切り替えと説明更新

**Files:** `src/ImageOcr.tsx`, `tests/image-ocr.test.ts`, `vite.config.ts`, `package.json`, `pnpm-lock.yaml`, `.dev.vars.example`, `wrangler.jsonc`, `README.md`

**Interfaces:** Task 1のOCR APIを使い、既存onText/onBusy契約と本文の確認・編集を維持する。

- [x] サーバー送信・429表示・通信失敗・アンマウントのテストを書いて失敗を確認する。
- [x] フォームを切り替え、Tesseract依存とビルド時OCR資材配信を削除する。
- [x] モデル・上限設定と画像送信の説明を更新する。
- [x] `pnpm run check` と依存監査を実行する。

### Task 3: レビューとPR

- [x] `/review` に相当する `codex review --base origin/main` で変更全体をレビューする。
- [x] 必要な指摘を修正し、関連検証とレビューを再実行する。
- [ ] 作業ブランチをpushし、目的・変更・検証・レビューを記載したmain向けPRを作成、チャットへ添付する。
