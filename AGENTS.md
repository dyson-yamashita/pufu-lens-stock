# リポジトリの作業ルール

- 常に日本語で回答してください。
- ユーザーの明示した目的に必要な調査・編集・検証を進め、承認済みの作業について改めて許可を求めないでください。
- スキルの手順は、ユーザーの指示・既存の合意と実行環境の制約を優先して適用してください。

## 開発用スキル

- 作業開始時に [using-superpowers](.agents/skills/using-superpowers/SKILL.md) を読み、依頼に関係するスキルを利用してください。
- Superpowersのスキルと補助ファイルは `.agents/skills/` にあります。利用するスキルの `SKILL.md` を読み、そこから必要な参照先を確認してください。
- スキル内の `superpowers:<名前>` は `.agents/skills/<名前>/SKILL.md` を指します。専用のスキル呼び出しツールがない場合は、そのファイルを直接読んで適用してください。
- 既存コードにテストを追加・改善するときは [pragmatic-testing](.agents/skills/pragmatic-testing/SKILL.md) を使い、既存のテスト基盤を再利用して重要な振る舞いを最小限のテストで保護してください。
- Superpowers由来のファイルは直接編集せず、更新時は取り込み元のコミットとライセンスを維持してください。取り込み情報は [.agents/superpowers-source.json](.agents/superpowers-source.json) にあります。
