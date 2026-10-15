# Cloudflare自動デプロイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mainへのPRマージ後、秘密情報を公開せず既存のCloudflare本番環境へ自動デプロイする。

**Architecture:** PRとmain更新で秘密情報を持たない検証ジョブを実行する。元リポジトリのmain更新に限り、別ジョブで本番ビルド後、Secretsを渡したステップでD1マイグレーションとWorker更新を順に実行する。

**Tech Stack:** GitHub Actions、Node.js 22、既存のnpm・Vitest・Wrangler・Cloudflare Vite plugin。

**Spec:** 今回の依頼「mainにPRマージするとCloudflareでデプロイ。公開リポジトリでも秘密情報を露出しない」。

## Global Constraints

- 最新のorigin/mainから作業ブランチを作成し、main向けPRを作る。既存の未コミット変更は含めない。
- 本番URL・既存バインディング・Cloudflare側のGoogle認証Secretを維持する。
- Cloudflare APIトークンとアカウントIDはGitHubのproduction EnvironmentのSecretsに置き、インストール・検証・ビルドに渡さない。
- pull_request_target、自己ホストrunner、成果物アップロード、秘密の直接記載は使わない。
- この作業でPRをマージしたり、本番D1変更・デプロイを実行したりしない。

## Review Focus

- forkのPRやmain以外の更新ではデプロイされず、Secretsも渡らない。
- 検証失敗・Secrets未設定・マイグレーション失敗でWorker更新まで進まない。
- 連続マージでデプロイが重ならず、実行中のマイグレーションを中断しない。
- Viteはproduction環境でビルドし、Wranglerは固定済み依存と正しい設定を使用する。
- 公開されるログ・Git差分・ビルド成果物に認証情報を追加しない。

## Task 1: ワークフローと運用手順

**Files:** Create `.github/workflows/cloudflare-deploy.yml`, `.npmrc`; Modify `README.md`, `package-lock.json`.

- [x] SHA固定の公式checkout/setup-node、contents:read、イベント・リポジトリ条件、concurrency、タイムアウトを定義する。
- [x] 検証とproduction用ビルドを行い、最後のステップにだけSecretsを渡してマイグレーション後にデプロイする。
- [x] READMEに初回Secrets登録・必要権限・main制限・マイグレーション運用・初回実行条件を記載する。
- [x] actionlint、npm run check、npm audit、本番ビルド、Wrangler dry-runを実行する。秘密未設定時の停止とローカルDBマイグレーションも確認する。
- [x] 差分と秘密情報の混入を確認し、レビュー後にコミット・push・PR作成する。本番は変更しない。

**CIで発見した修正:** ローカルのユーザー設定が `legacy-peer-deps=true` であったため、既存lockfileに `react-sortablejs` のpeer依存 `@types/sortablejs` が欠落していた。通常のpeer解決でCIの失敗をローカルでも再現し、lockfileに不足分を補完する。`.npmrc` でpeer解決を有効に固定し、ユーザー設定による再発を防ぐ。既存パッケージのバージョン更新は行わない。
