# Pufu Lens skills

利用者のCodex・Claude Codeなどで実行するAgent Skillsです。推論は利用者のAIの利用枠を使い、Pufu Lensへのデータ取得・保存には既存のMCP接続を使います。スキルの導入だけではMCP接続や認可は完了しません。

| Skill                                         | 用途                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| [deepen-questions](deepen-questions/SKILL.md) | 複数ストック・既存の問い・本人の意見から、言い換えを避けて問いを育てる |

インストール方法・利用条件・使い方は、Pufu Lensのユーザーマニュアルの「スキルで問いを深める」を参照してください。外部連携ページからも開けます。配布には[skills CLI](https://github.com/vercel-labs/skills)を使い、取得先をこのディレクトリに限定します。リポジトリルートを指定すると、開発用 `.agents/skills/` も探索対象になるため、マニュアルのURLを使ってください。

These Agent Skills run in your own AI client using your AI allowance. Connect and authorize Pufu Lens MCP separately. See “Deepen questions with a skill” in the Pufu Lens user manual, also linked from Integrations. Install from this directory rather than the repository root to keep development skills out of the selection.

## スキルを追加・更新する開発者向け

- 新しいスキルは `skills/<skill-name>/SKILL.md` に置き、frontmatterにディレクトリと一致する `name` と、使う場面を記した `description` を設定します。
- 一つのスキルは一つの利用目的に絞ります。参照資料や評価ケースはスキル自身のディレクトリ内に置き、単独インストールでも動くようにします。
- 利用者の入力・設定を優先します。秘密情報、APIキー、個人データ、固定の個人用IDを同梱しません。MCP接続先は利用者の外部連携ページで確認し、認可はクライアントに任せます。
- `metadata.version` を更新し、この一覧とマニュアルを必要に応じて更新します。配布するスキルと開発用 `.agents/skills/` は独立して管理します。
- `evals/` の架空データで、スキルを読み込まない場合と読み込んだ場合を比較します。実データを保存せず、候補の質・取得範囲・登録判断・機密性を確認します。
- 公開前にskills CLIで限定パスの一覧・隔離した導入先を確認します。更新・追加は利用者のCLIから取得し、既存インストールの自動更新を前提にしません。

ライセンスはリポジトリの[BSD-3-Clause](../LICENSE)です。
