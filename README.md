# Pufu Lens

記事やメモをプロジェクトごとに集め、AIの要約と問いで考えを深めるアプリです。関心や知識を「メモリ」に整理し、行動計画となる「プ譜（プロジェクト譜）」を作成・編集できます。

## ローカルで試す

**Node.js 22.22.3以降の22系、または24.11以降（推奨24系） / pnpm 11.28.6** が必要です。Corepackを使う場合は、初回に `corepack enable` を実行します。

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm run dev
```

[http://localhost:5173/](http://localhost:5173/) で「ローカルデモを開く」を選ぶと、Cloudflare・Googleの認証情報なしで試せます。AI未接続時は本文の抜粋や定型の案を使います。実際のAI生成を試す場合は、[Workers AIの設定と料金](docs/SPEC.md#ローカルでworkers-aiを使う)を確認してください。

## 基本の流れ

1. プロジェクトを作り、「記事をストック」からURLやテキストを保存します。
2. 要約と問いを確認し、自分の問いやメモを追加します。
3. 問いの詳細で「問いの解決を考える」から課題を入力し、「プ譜を作成」で計画を作ります。編集・振り返りは局面として保存できます。

通常利用はGoogleアカウントでログインし、初回登録を完了して始めます。詳しい操作はアプリ内の「ユーザーマニュアル」を参照してください。

プロジェクトは初期状態で非公開です。共有する場合は、[公開範囲と設定](docs/SPEC.md#プロジェクトの公開)を確認してください。

## 詳細ドキュメント

コードの入口と機能別フォルダの役割は[コードの読み方](docs/ARCHITECTURE.md)を参照してください。

| 内容                             | 参照先                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 機能・データ・API・利用上限      | [詳細仕様](docs/SPEC.md)                                                                                               |
| iPhone・MCP・Xとの連携           | [iOSショートカット](docs/SPEC.md#iosショートカット) / [MCP](docs/SPEC.md#mcp連携chatgptなど) / [X](docs/SPEC.md#x連携) |
| Codex CLI・Claude Code向けスキル | [配布スキル一覧](skills/README.md)                                                                                     |
| 開発環境・認証・AI設定           | [ローカル開発](docs/SPEC.md#ローカル開発)                                                                              |
| 本番環境の構築・デプロイ         | [本番設定](docs/SPEC.md#cloudflareの本番設定)                                                                          |
| 開発・検証・E2E                  | [開発と検証](docs/SPEC.md#開発と検証) / [ブラウザーE2E](packages/e2e/README.md)                                        |
| 配色・レイアウト・画面設計       | [デザイン仕様](docs/DESIGN.md)                                                                                         |
| お知らせ・Push通知の運用         | [運用手順](docs/ANNOUNCEMENTS.md)                                                                                      |
| フィードバック保守               | [保守手順](docs/FEEDBACK.md)                                                                                           |
| ブランチ・PR・開発スキル         | [作業ルール](AGENTS.md)                                                                                                |

## ライセンス・商標

独自ソースコードのライセンスは [BSD-3-Clause](LICENSE) です。第三者コードは各提供元のライセンスに従います：[Pufu editor（BSD-3-Clause）](public/licenses/pufu-editor.txt)、[Superpowers（MIT）](.agents/SUPERPOWERS-LICENSE)、[Miniflareパッチ（MIT）](patches/LICENSE-MIT)、[MCP Apps SDK](public/licenses/mcp-apps.txt)。

「プ譜」は株式会社ゴトーラボの登録商標です。
