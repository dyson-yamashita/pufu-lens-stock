# Pufu Lens Stock

独自ソースコードのライセンスは [BSD-3-Clause](LICENSE) です。第三者コードは各提供元のライセンスに従います：[Pufu editor（BSD-3-Clause）](public/licenses/pufu-editor.txt)、[Superpowers（MIT）](.agents/SUPERPOWERS-LICENSE)、[Miniflareパッチ（MIT）](patches/LICENSE-MIT)。

気になった記事や自分のメモを集め、問いを深め、行動につなげるためのアプリです。

Web・Xの投稿・YouTube動画のURLやテキストをプロジェクトごとにストックすると、AIが要約と問いを生成します。集めた情報から関心や知識を「メモリ」に整理し、問いを解決するための「プ譜（プロジェクト譜）」を作成・編集できます。

## できること

- **集める** — URLやテキストを保存。iPhoneのショートカットやMCPからも追加できます。
- **読み返す** — 要約・本文・メモを確認し、検索やお気に入りで探せます。
- **考える** — AIが生成した問いや、自分で追加した問いを蓄積できます。ストックなしの問いも保存できます。
- **つなげる** — プロジェクトごと、ユーザー全体の関心と知識をメモリとして更新します。
- **行動にする** — 問いに対する課題を入力してプ譜を生成。編集と振り返りを局面として保存できます。

Googleアカウントでログインし、複数のプロジェクトを管理します。記事・問い・メモリ・プ譜はユーザーごとに保存されます。

## まずはローカルで試す

**Node.js 22.18以降の22系、または24.11以降（推奨24系） / pnpm 10.34.7** を使用します。Corepackを使う場合は、初回に `corepack enable` を実行してください。

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm run dev
```

[http://localhost:5173/](http://localhost:5173/) を開き、「ローカルデモを開く」を選びます。CloudflareやGoogleの認証情報なしで試せます。`setup` は開発用設定とローカルDBを準備し、既存の `.dev.vars` は上書きしません。

デモにはサンプル記事が含まれます。AI未接続時は本文の抜粋や定型の案を使い、保存からプ譜の編集までの流れを確認できます。本物のAI生成を試す場合は、[Workers AIの設定](docs/SPEC.md#ローカルでworkers-aiを使う)を参照してください。AIへ送った資料はCloudflareで処理され、利用量に応じて料金が発生します。

## 基本の使い方

1. プロジェクトを作り、「記事をストック」からURLまたはテキストを保存します。
2. 要約を読み、生成された問いを確認します。「問いを追加」から自分の問いも残せます。
3. 問いの詳細で「問いの解決を考える」を選び、実現したいことを課題として入力します。
4. 「プ譜を作成」で案を生成し、編集・保存します。局面を追加すると、編集と振り返りを続けられます。

プロフィールの自己紹介やプロジェクト概要を書くと、メモリやプ譜の生成に背景情報を反映できます。

MCPのストック一覧は、既定でID・タイトル・要約の抜粋などを返します。最新1件なら `list_stocks` に `limit: 1` を指定でき、要点・メモ・本文が必要なストックだけ `get_stock` で取得します。従来の一覧形式が必要な場合は `detail: "full"` を指定してください。本文は一覧の検索対象に含まれません。

MCPでの接続URL・権限設定・本番準備は、[MCP連携の説明](docs/SPEC.md#mcp連携chatgptなど)を参照してください。

## ドキュメント

| 読みたい内容                                   | ドキュメント                                            |
| ---------------------------------------------- | ------------------------------------------------------- |
| 機能・API・データ・利用上限                    | [詳細仕様](docs/SPEC.md)                                |
| 現在の配色・レイアウト・画面と操作             | [デザイン仕様](docs/DESIGN.md)                          |
| スマホからのローカル確認・Google認証・AI設定   | [開発環境の設定](docs/SPEC.md#ローカル開発)             |
| iPhoneの共有シートから保存する                 | [iOSショートカット連携](docs/SPEC.md#iosショートカット) |
| Cloudflareの構築・GitHub Actionsによるデプロイ | [本番環境の設定](docs/SPEC.md#cloudflareの本番設定)     |
| ブランチ・PR・開発スキルの使い方               | [作業ルール](AGENTS.md)                                 |

mainへの直接push禁止は、[GitHub Rulesetの適用手順](docs/SPEC.md#mainへの直接pushを禁止する)を参照してください。PRのマージだけでは有効になりません。

## 開発する

React / Viteの画面と、Cloudflare Workers・D1・R2・Workflows・Workers AIで構成しています。プ譜エディターは `@goto-lab/pufu-editor` を直接組み込んでいます。

```sh
pnpm run check
pnpm audit
```

`check` は型チェック・lint・テスト・整形チェック・ビルドを実行します。変更は最新のmainから作成したブランチで行います。検証と [requesting-code-review](.agents/skills/requesting-code-review/SKILL.md) による独立エージェントのレビューを完了してからPRを作成します。

設定値の例は [.dev.vars.example](.dev.vars.example) にあります。APIキーなどの秘密情報は `.dev.vars` やサービス側のSecretsで管理し、Gitへ追加しないでください。

本番URLはビルド時の環境変数 `APP_URL`、D1・OAuth KVの実IDは `D1_DATABASE_ID`・`OAUTH_KV_ID` で指定します。GitHub Actionsでは `production` EnvironmentのVariablesに設定してください。`wrangler.jsonc` の本番URL・IDはダミーで、必須値が未設定または不正なら本番ビルドは停止します。[本番設定の手順](docs/SPEC.md#cloudflareの本番設定)を参照してください。

## X連携

「外部連携」からX公式APIの **Bearer Token** を登録・更新・削除できます。従来のMCP接続も同じ画面から利用できます。Xの開発者契約・読み取り権限・利用枠が必要です。登録時は保存のみ行い、実際の投稿取得で認証を確認します。

管理者は本番DBへマイグレーション `0017_external_integrations.sql` を適用し、`INTEGRATION_ENCRYPTION_KEY` を64文字のランダムな16進数としてCloudflare Workers Secretに設定してください（例: `openssl rand -hex 32` で生成し、`corepack pnpm exec wrangler secret put INTEGRATION_ENCRYPTION_KEY --env production` で登録）。値はログ・Git・チャットへ貼らず、安全に保管してください。キーを変更すると既存のトークンを復号できなくなるため、各ユーザーの再登録が必要です。ローカルではGit管理対象外の `.dev.vars` に設定します。

認証情報はユーザーIDに結び付けたAES-256-GCMで暗号化し、サーバー側のDBに保存します。APIには登録状態だけを返し、MCP・共有用トークンによる管理アクセスを拒否します。復号したトークンは固定の `https://api.x.com/2/tweets/{id}` にだけ送信し、リダイレクトを拒否します。

「記事をストック」でXの投稿URLを入力すると本文を取得します。短い投稿と長文投稿に対応します。取得できない場合もURLは残り、詳細画面から本文を貼り付けて補完し、再試行できます。既に保存したURLへの再保存は従来どおり重複扱いとなるため、取得失敗後の補完には詳細画面を使ってください。

## YouTube動画のストック

YouTubeの通常の動画URL・短縮URL・Shorts・ライブ動画・埋め込みURLから、YouTube Data API v3でタイトル・説明文・チャンネル名・サムネイルを取得します。要約・問いは取得した情報の範囲で作成し、動画本編・音声・字幕は取得しません。説明文が短い、または空でもタイトルを保存できます。

Google Cloudで **YouTube Data API v3** を有効にしてAPIキーを作成し、キーのAPI制限を同APIに限定してください。管理者が次のコマンドで本番のCloudflare Workers Secretへ登録します（値は対話入力し、Git・ログ・チャットに貼り付けません）。公開動画の取得にGoogleログイン用のOAuth設定は不要です。

```sh
pnpm exec wrangler secret put YOUTUBE_API_KEY --env production
```

ローカルではGit管理対象外の `.dev.vars` に `YOUTUBE_API_KEY` を設定し、開発サーバーを再起動します。ブラウザの `VITE_` 付き変数には設定しません。キーはアプリ全体で使用し、API利用量はそのGoogle Cloudプロジェクトに集計されます。

マイグレーション `0019_youtube_metadata.sql` を適用してからWorkerをデプロイしてください。キー未設定・API制限・削除済みや非公開の動画などで取得に失敗してもURLは残り、キーの登録・設定修正後はストック詳細の「取得を再試行」から再取得できます。本文を補完して再試行する場合は入力内容を優先し、YouTube APIを呼びません。サムネイルは詳細表示時にYouTubeの画像サーバーから読み込みます。

## プロジェクトの公開

プロジェクトの「設定」→「公開設定」で公開できます。初期状態は非公開です。公開すると `/p/<公開ID>` の参照URLが発行され、ログイン前のトップページにも掲載されます。

- 公開する内容：プロジェクト名・公開用の紹介文、ストックのタイトル・URL・要約・要点・トピック、問い、紐づくプ譜の最新局面と振り返り。
- 公開しない内容：内部用のプロジェクト概要、ユーザー／プロジェクトのメモリ、ストックの個人メモ・取得本文、生成時のコンテキスト。
- プ譜そのものに記載した内容は公開されます。公開前に各内容を確認してください。
- 公開後の追加・編集も反映されます。非公開にするとトップ掲載とURLからの参照が停止します。再公開時は同じURLを使います。
- 公開ページと `/api/public/projects` 以下のAPIは参照専用です。公開設定は所有者のログインセッションからのみ変更でき、MCPやショートカットのトークンでは変更できません。

デプロイ前に `pnpm run db:migrate:production` で `0020_public_projects.sql` を適用してください。既存プロジェクトも非公開のまま移行します。
