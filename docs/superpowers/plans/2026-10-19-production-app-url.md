# 本番APP_URLの環境変数化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 本番URLを追跡ファイルから除き、環境変数 `APP_URL` で指定する。

**Architecture:** `wrangler.jsonc` は `https://app.example.invalid` を例示値とする。ViteのCloudflare設定フックで本番ビルド時だけ `APP_URL` を検証し、生成されるWorker設定のvarsに注入する。GitHub Actionsはproduction Environment secretsからビルドへ渡す。

**Tech Stack:** TypeScript、Vite、Cloudflare Vite plugin、Vitest、GitHub Actions。

**Spec:** 本チャットの「本番URLをダミーにして環境変数で制御する」依頼。

## 制約と検証観点

- 通常のローカル開発・PR検証はAPP_URL未設定で動く。
- 本番ビルドは未設定、不正URL、HTTP、認証情報・パス・クエリ・フラグメント付きURL、localhostや.invalidを拒否する。
- HTTPSのオリジンを受け入れ、末尾スラッシュを除いてGoogle OAuthのURL連結を維持する。
- Cloudflareの認証情報は従来どおり最後のデプロイステップにだけ渡す。
- 過去のGit履歴は変更しない。マージ・本番デプロイは行わない。

## Task 1: 設定・検証・文書を一体で更新

対象: `scripts/production-config.ts`、`tests/production-config.test.ts`、`vite.config.ts`、`wrangler.jsonc`、`.github/workflows/cloudflare-deploy.yml`、`docs/SPEC.md`、`README.md`。

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

## 公開準備への追加要件

- [x] 独自コードをBSD-3-Clauseとし、著作権者をYamashitaとする。第三者ライセンスは保持する。
- [x] Miniflare上流コミットのMIT許諾文を変更せず同梱する。
- [x] D1・OAuth KVの実IDも環境変数へ移し、生成設定をDB移行とデプロイで共有する。サービスの公開範囲と過去履歴は変更しない。
- [x] main用Rulesetを用意して適用を試す。GitHubが現在の非公開リポジトリでの適用をプラン制限（403）で拒否したため、定義と適用手順をPRに含める。
- [x] 拡張した設定を検証し、独立レビューの指摘を修正する。
- [x] 差分全体のCLIレビューを完了する。
- [ ] 作業ブランチをpushしてPRを作成する。

## 公開準備の追加検証

- 設定テスト19件を含む全39ファイル・377テスト成功（並列数1）。型・lint・format・actionlint・通常ビルドも成功。
- APP_URL・D1_DATABASE_ID・OAUTH_KV_IDをそれぞれ欠いた本番ビルドは、該当する変数名を示して停止した。
- 最初の本番dry-runで、プラグインが返却配列を連結するためDB・KVが重複することを検出。既存設定を直接更新する方法へ修正した。
- 修正後の本番ビルドではURLとIDを注入し、DB・KVが各1件であることを確認。Wrangler deployのdry-run、および生成設定を指定したローカルD1マイグレーション一覧取得が成功した。本番への反映は行っていない。
- 独立レビューで初回構築のKV作成手順を補い、Rulesetには必須CIチェックが含まれないことを明記。再レビューで要対応の指摘なし。
- GitHubのproduction Environmentへ既存のURL・D1・KVの値を登録済み。Rulesetの実適用はGitHubのプラン制限により未完了。
- `codex review --base origin/main` は要修正の指摘なし。設定テスト19件・型チェック・差分の空白チェックもレビュー内で成功。

## Environment secretsへの移行

- APP_URL・D1_DATABASE_ID・OAUTH_KV_IDをproduction Environment secretsへ移し、Workflowの参照をsecretsへ変更する。
- Secrets登録後に同名Variablesを削除し、README・SPECの運用手順を更新する。認証情報は従来どおり最後のデプロイステップに限定する。
- 最新mainを取り込んだ差分全体を独立レビューし、既存PR #55へ反映する。本番デプロイ・マージは行わない。

- 3つのSecretsの登録成功と名前の存在を確認し、同名Variablesを削除済み。値は出力しない方法で移行した。
- 型・lint・format・actionlint・設定テスト19件・通常ビルド成功。利用者の操作は変わらず、ユーザーマニュアル更新は不要。
- 独立レビューで最新main由来の実URL表記3件を検出・置換し、追跡対象ファイルの実URL・ID残存なしを確認。再レビューは要修正指摘なし。
