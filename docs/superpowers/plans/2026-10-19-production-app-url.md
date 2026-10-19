# 本番APP_URLの環境変数化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 本番URLを追跡ファイルから除き、環境変数 `APP_URL` で指定する。

**Architecture:** `wrangler.jsonc` は `https://app.example.invalid` を例示値とする。ViteのCloudflare設定フックで本番ビルド時だけ `APP_URL` を検証し、生成されるWorker設定のvarsに注入する。GitHub Actionsはproduction Environment variableからビルドへ渡す。

**Tech Stack:** TypeScript、Vite、Cloudflare Vite plugin、Vitest、GitHub Actions。

**Spec:** 本チャットの「本番URLをダミーにして環境変数で制御する」依頼。

## 制約と検証観点

- 通常のローカル開発・PR検証はAPP_URL未設定で動く。
- 本番ビルドは未設定、不正URL、HTTP、認証情報・パス・クエリ・フラグメント付きURL、localhostや.invalidを拒否する。
- HTTPSのオリジンを受け入れ、末尾スラッシュを除いてGoogle OAuthのURL連結を維持する。
- Cloudflareの認証情報は従来どおり最後のデプロイステップにだけ渡す。
- 過去のGit履歴は変更しない。マージ・本番デプロイは行わない。

## Task 1: 設定・検証・文書を一体で更新

対象: `scripts/production-app-url.ts`、`tests/production-app-url.test.ts`、`vite.config.ts`、`wrangler.jsonc`、`.github/workflows/cloudflare-deploy.yml`、`docs/SPEC.md`、`README.md`。

- [x] URL検証の失敗をテストで確認し、`productionAppUrl(value: string | undefined): string` を実装する。
- [x] 本番ビルド設定へ値を注入し、Workflowと文書の実URLを置き換える。
- [x] 全テスト・型・lint・format・通常ビルド・actionlintを実行する。本番ビルドの未設定拒否と生成設定のURLを確認し、Wranglerのdry-runで検証する。
- [x] production Environment variableに既存URLを登録し、独立レビューとCLIレビューを完了する。
- [ ] 作業ブランチをpushしてPRを作成する。

## 検証結果

- URL検証12件をRED→GREENで確認。全体は39ファイル・370テスト成功（並列数1）。
- 最初の通常並列実行はローカル接続のEADDRNOTAVAILと関連エラーで9ファイル・23件が失敗。テスト内容や設定を変更せず再実行した。
- 型・lint・format・通常ビルド・actionlint・本番ビルド・Wrangler dry-run成功。未設定とダミー値では本番ビルドが停止し、正常値は生成設定へ注入された。
- 独立レビューと `codex review --uncommitted` は修正指摘なし。
- マニュアル更新なし：利用者の基本操作・利用条件・既存説明に変更なし。
