# コードの読み方

Pufu Lensは、Reactのフロントエンド、Cloudflare Workers上のAPI・非同期処理、両方で使う共有定義で構成されています。

## 最初に読むファイル

| 確認したいこと                                       | 入口                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| ページの起動と公開・マニュアル・法務ページの振り分け | [`src/main.tsx`](../src/main.tsx)                               |
| ログイン後の画面の組み立て                           | [`src/app/App.tsx`](../src/app/App.tsx)                         |
| 画面遷移・履歴・一覧へ戻る操作                       | [`src/app/useAppNavigation.ts`](../src/app/useAppNavigation.ts) |
| データ取得・定期更新・更新競合の防止                 | [`src/app/useAppData.ts`](../src/app/useAppData.ts)             |
| WorkerのHTTP・scheduled・Workflowの入口              | [`server/index.ts`](../server/index.ts)                         |
| APIルートとミドルウェアの登録順                      | [`server/api/app.ts`](../server/api/app.ts)                     |
| MCPの認証とツールの組み立て                          | [`server/mcp/server.ts`](../server/mcp/server.ts)               |

## フォルダの役割

```text
src/
  main.tsx            フロントエンドの入口
  app/                全体の組み立て、画面遷移、サイドバー、モーダル
  features/           機能専用の画面・フォーム・処理・CSS
  components/         複数機能で使うUI
  lib/                API通信・日付表示
  i18n/               言語設定・翻訳辞書・言語選択UI
  styles/             共通の色・基本UI・レイアウトとCSSの読込順
  mcp-pufu-viewer/    MCP Apps用の独立したブラウザーエントリー
  assets/             アプリ内の画像
server/
  index.ts            Workerの入口
  env.ts              binding・認証主体・ジョブの型
  api/                APIの組み立て・機能別ルート・共通検証
  features/           機能ごとの保存・取得・生成処理
  mcp/                OAuth・接続設定・共通実行基盤・機能別ツール
  infrastructure/     DB・AI接続・ジョブ実行・通信の保護・ログ
shared/               フロントエンドとサーバーの共有型・入力スキーマ
packages/
  pufu-image/         プ譜のSVG・PNG生成
  e2e/                実ブラウザーによる操作テスト
tests/                Vitestの回帰テスト・共通fixture
migrations/           D1スキーマの変更
scripts/              開発・ビルド・運用・テスト用のツール
```

## 機能から探す

ストックは `src/features/stocks/` と `server/features/stocks/`、プ譜はそれぞれの `features/pufu/`、メモリは `features/memory/` を見ます。APIのHTTP処理は `server/api/routes/` にあります。

ログイン・初回登録は `features/auth/`、プロフィールと通知・テーマ設定は `src/features/settings/`、利用量の集計は `server/features/usage/` です。公開設定と匿名閲覧は `features/public-projects/` にまとめています。

プ譜のサーバー処理は、保存・読み込みを `features/pufu/`、AI生成を `generation/`、画像生成と画像リンクを `images/` に分けています。PDF解析Workerは `server/features/stocks/pdf/pdf-worker.ts` が入口です。

## 配置と依存関係のルール

- 機能専用の部品・フック・CSSは、その機能のフォルダへ置きます。共通UIの `components/` に業務処理を集めません。
- `app/` は機能を組み合わせます。個々の機能から `App.tsx` を参照しません。
- `shared/` は `src/` と `server/` を参照しません。両方で必要な型・入力制約はここを基準にします。
- APIの共通認証と入力上限は `api/middleware/`、所有権検証は `api/context.ts` にあります。新しいルートも既存の共通経路へ登録します。
- MCPツールは `mcp/tools/` に置きます。権限スコープ・許可プロジェクト・API呼び出し・エラー変換は `mcp/tool-context.ts` を使います。
- CSSは `src/styles/styles.css` で明示した順序で読み込みます。後段のレスポンシブ指定や上書きの順序を変える場合は、影響する画面を確認します。
- 利用者向けの操作説明は `src/features/manual/UserManual.tsx`、開発者向けの構成説明はこの文書で管理します。

## 変更したら確認すること

`pnpm run check` で型・lint・Vitest・整形・ビルドを確認します。操作に関わるファイルを移動・分割した場合は、`packages/e2e/scenarios.json` の担当ソースも更新します。

`pnpm run e2e:check` で台帳の整合性、`pnpm run e2e:related --base origin/main` で関連する実操作を検証できます。共通の組み立て・UI・通信・翻訳・スタイル・認証の変更は全シナリオを選びます。詳しい実行条件は[ブラウザーE2E](../packages/e2e/README.md)を参照してください。
