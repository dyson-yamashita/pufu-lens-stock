# リポジトリの作業ルール

- 常に日本語で回答してください。
- ユーザーの明示した目的に必要な調査・編集・検証を進め、承認済みの作業について改めて許可を求めないでください。
- スキルの手順は、ユーザーの指示・既存の合意と実行環境の制約を優先して適用してください。

## ブランチとプルリクエスト

- 実装・修正の依頼は、必要な検証・レビュー・コミット・作業ブランチのpush・`main` をベースとするPR作成までを依頼範囲に含むものとして扱い、これらの通常工程について改めて実行許可を求めないでください。
- ユーザーが明示的にPR不要と指定した場合を除き、実装後はPRを作成し、そのURLと検証結果を報告してください。マージや本番反映は別途明示的な指示がある場合にのみ行ってください。
- 修正に着手する前に `git fetch origin` を実行し、最新の `origin/main` を起点に作業ブランチを作成してください。
- 変更は作業ブランチで行い、`main` への直接コミット・直接pushは行わないでください。
- 作業前から存在する未コミット変更は保持し、今回の修正と無関係な変更をコミットやPRに含めないでください。
- PR作成前に必ず [security-audit](.agents/skills/security-audit/SKILL.md) を `standard` プロファイルの scoped run で実行してください。最新の `origin/main` と作業ブランチの共通祖先からの修正差分（未コミットの変更・追加ファイルを含む）を対象にし、差分が依存する呼び出し元・権限制御も必要に応じて確認してください。監査で対応が必要な指摘を修正した後は、必要な検証と再監査を実施してください。
- PR作成前に必ず [requesting-code-review](.agents/skills/requesting-code-review/SKILL.md) を使い、独立したレビュー担当エージェントによる変更全体のレビューを完了してください。
- レビュー担当には変更の目的・要件・対象差分・検証結果を伝え、作業ツリーを変更しない読み取り専用レビューを依頼してください。
- 対応が必要な指摘は修正し、修正後は必要な検証と `requesting-code-review` による再レビューを実施してください。
- 修正内容に応じたテスト・型チェック・lintなどの検証と上記レビューの完了後、作業ブランチをpushし、`main` をベースにPRを作成してください。
- PRには変更の目的・内容・検証結果・scoped run監査の対象範囲・結果・未確認事項・レビュー実施結果を記載し、作成したPRのURLをユーザーへ報告してください。ユーザーから明示的な指示がない限り、PRをマージしないでください。

## 開発用スキル

- 作業開始時に [using-superpowers](.agents/skills/using-superpowers/SKILL.md) を読み、依頼に関係するスキルを利用してください。
- Superpowersのスキルと補助ファイルは `.agents/skills/` にあります。利用するスキルの `SKILL.md` を読み、そこから必要な参照先を確認してください。
- スキル内の `superpowers:<名前>` は `.agents/skills/<名前>/SKILL.md` を指します。専用のスキル呼び出しツールがない場合は、そのファイルを直接読んで適用してください。
- セキュリティ診断・脆弱性レビューの依頼では [security-audit](.agents/skills/security-audit/SKILL.md) を読み、依頼範囲に応じてガイダンスまたは監査の手順を適用してください。
- 既存コードにテストを追加・改善するときは [pragmatic-testing](.agents/skills/pragmatic-testing/SKILL.md) を使い、既存のテスト基盤を再利用して重要な振る舞いを最小限のテストで保護してください。
- 機能を追加・変更・削除するときは [maintaining-user-manual](.agents/skills/maintaining-user-manual/SKILL.md) を使い、ユーザーマニュアルへの影響を判断してください。基本操作・利用条件・公開範囲や説明の正しさに影響する場合だけ更新し、文言・見た目の微調整や内部改善だけの場合は更新しないでください。
- Superpowers由来のファイルは直接編集せず、更新時は取り込み元のコミットとライセンスを維持してください。取り込み情報は [.agents/superpowers-source.json](.agents/superpowers-source.json) にあります。
- Cloudflare由来の `security-audit` と補助ファイルは原文を保持し、更新時は取り込み元のコミットとMITライセンスを維持してください。取り込み情報は [.agents/security-audit-source.json](.agents/security-audit-source.json)、ライセンスは [.agents/SECURITY-AUDIT-LICENSE](.agents/SECURITY-AUDIT-LICENSE) にあります。
