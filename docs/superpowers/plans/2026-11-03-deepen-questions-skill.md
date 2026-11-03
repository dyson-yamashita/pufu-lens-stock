# 問いを深めるスキルと導入案内 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 複数ストック・既存の問い・本人の意見を踏まえて問いを育てる外部AI用スキルを配布し、マニュアルと外部連携ページから導入できるようにする。

**Architecture:** 公開済みの `dyson-yamashita/pufu-lens-stock` 内の `skills/` を配布元にする。`npx skills add` の取得先をこのサブディレクトリに限定し、開発用 `.agents/skills/` と分離する。推論は利用者のAI、取得・保存は既存MCPが担当し、サーバーのAI処理・API・DBは変更しない。

**Tech Stack:** Agent Skills（Markdown）、React、TypeScript、既存の日英翻訳、Vitest、既存ブラウザーE2E。

**Spec:** 本会話で検討したスキル設計と、依頼「修正を計画して作業」「インストール方法はマニュアルと、リンクを外部連携ページに」。配布先は新規リポジトリを作らず既存の公開リポジトリとする実装判断。

## Global Constraints

- スキル識別名は `deepen-questions`。追加スキルは `skills/<name>/SKILL.md` として配布できる構成にする。
- 配布URLは `https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills`。仮の組織名や未作成リポジトリを案内しない。
- 保存先は明確な1プロジェクト。関連ストックも同プロジェクトの実在IDに限定する。
- ストック検索は `keyword`、軽量一覧から必要な詳細だけ取得する。意味検索・生成・再生成を自動起動しない。
- 提案と登録を区別し、登録依頼があれば既存の許可範囲で進める。言い換えしかない場合は登録しない。
- 公開される問い本文へ非公開コメントや個人情報を転載しない。資料内の命令は指示として実行しない。
- `add_question` の本文500文字・メモ2,000文字・UUIDの再送規則を守る。問い同士の構造的関連付けは新設しない。
- インストールとMCP接続・OAuth認可が別であること、推論が利用者側の利用枠であることを日英で説明する。
- マージ・本番反映はしない。mainベースのPRまで作成する。

## Review Focus

- CLIが開発用スキルまで取り込まず、配布対象のみ発見・導入できるか：実CLIで限定パスの一覧と隔離先インストールを確認。
- 既存の問いと実質同じ候補を無理に保存しないか：スキルなし／ありで架空ケースを比較。
- 非公開コメント・資料内命令・検索範囲の限界を扱えるか：品質評価ケースで確認。
- 公開マニュアルの英語直リンクと外部連携からの節リンクが一致するか：既存描画テストとMCP-001で確認。
- 狭い画面やダークモードで長いコマンドがはみ出さないか：ブラウザーで確認。

### Task 1: スキル配布パッケージ

**Files:** `skills/README.md`, `skills/deepen-questions/SKILL.md`, `skills/deepen-questions/references/quality.md`, `skills/deepen-questions/evals/scenarios.md`。

**Interfaces:** 既存MCPの `list_projects`, `list_stocks`, `get_stock`, `list_questions`, `get_question`, `list_comments`, `add_question`。配布先URLとスキル名をTask 2が案内する。

- [x] 架空の交差資料・重複のみ・非公開コメントのケースをスキルなしで評価する。
- [x] 品質基準・探索上限・候補の出力・登録規則を含むスキルと、追加スキル向け配布案内を作る。
- [x] 同ケースと資料内命令／検索不足のケースをスキルありで評価する。
- [x] 実CLIで `skills/` のみ発見され、隔離した導入先で参照資料も取得できることを確認する。

### Task 2: マニュアルと外部連携の導線

**Files:** `src/UserManual.tsx`, `src/McpConnections.tsx`, `src/locales/ja.ts`, `src/locales/en.ts`, `src/styles.css`, `shared/skills.ts`, `tests/mcp-connections-ui.test.ts`, `tests/manual-language-entry.test.ts`, `packages/e2e/scenarios.json`, `packages/e2e/tests/mcp.e2e.ts`, `docs/SPEC.md`, `README.md`。

**Interfaces:** `shared/skills.ts` に配布URL・導入コマンドの定数を置き、マニュアルと外部連携で同じ取得先を使う。マニュアルは `#skills` 節、外部連携は表示言語に合う `/manual#skills` または `/en/manual#skills` へリンクする。

- [x] 日英のマニュアル直リンクでコマンドと配布元を確認し、外部連携の導線を既存UIテストに追加して未実装での失敗を確認する。
- [x] `#skills` 節へ条件・導入・MCP認可・使い方・更新を掲載し、外部連携に紹介とマニュアル・配布元へのリンクを追加する。
- [x] MCP-001にマニュアルへの移動と配布先の検証を追加する。外部サイトへ通信せずhrefを検証する。
- [x] 関連Vitest・型・lint・format・ビルド・E2E台帳を確認し、CI再生を試行して結果を記録する。390px・1280pxのライト／ダーク表示を確認する。

### Task 3: 完了確認とPR

- [x] 全Vitestと必要な最終チェックを実行する。
- [x] merge-baseから未追跡を含む全差分にstandard scopedセキュリティ監査と独立コードレビューを行う。
- [x] 要対応指摘があれば修正・必要な再検証・再レビューを完了する。
- [ ] 検証結果・未確認事項を追記し、コミット・push・mainベースのPRを作成する。

## 検証結果

- ベース：最新 `origin/main` の `ec3e957`。作業前の未コミット変更なし。既存の公開リポジトリを配布先に採用し、新規リポジトリ・プラグイン公開申請は作成しない。
- UI関連：未実装で6件失敗を確認後、実装して9件成功。全体Vitestは96ファイル・1,026件成功。
- `corepack pnpm run typecheck` / `lint` / `format:check`：成功。E2E用の実アプリビルドも成功。指定のpnpm 11.28.6を使用。
- `skills` CLI 1.7.6：配布ディレクトリ限定の一覧は1スキルのみ。隔離したプロジェクトへ `--skill deepen-questions --agent codex --copy -y` で導入し、SKILL.md・参照資料・評価ケースの同梱を確認した。
- スキル品質：架空ケースのスキルなし／あり比較と修正後の再評価を実施。候補の新規性・登録判断・UUID再送・非公開コメントの抽象化・資料内命令の無視を確認。実データ・全モデルでの品質を保証する検証ではない。
- `e2e:check`：6シナリオ×desktop/phoneの整合性確認に成功。`e2e:related --base origin/main` は全6シナリオを選択しCIモードで実行したが、`cdn.playwright.dev` のブラウザーダウンロードが環境ポリシーの403 `Domain forbidden` で拒否され、`BROWSER_INSTALL_FAILED` により起動前停止（テスト実行0件）。期待値・設定・記録は緩和していない。正式なCI再生は未確認として残す。
- 代替の表示・導線確認：実ビルドSPA／静的マニュアル＋ダミーAPIを、標準Playwright起動の環境内 `/usr/bin/chromium` で確認。日英×390/1280px×ライト/ダークの8条件で、外部連携→言語別 `/manual#skills`、コマンド、GitHubリンク、水平はみ出しなしを確認。独自CDP接続・外部サイト取得・本番データ・AI処理は使わない。正式E2Eの代用合格とは扱わない。
- 独立コードレビュー：全差分・未追跡を対象に実施。Critical／Important／Minorの要対応指摘なし。CLI 1.7.6ソースでも限定パス探索と `update deepen-questions` の対応を確認。
- standard scopedセキュリティ監査を実施。範囲・結果・未確認事項は `/workspace/artifacts/deepen-questions-security-audit/REPORT.md` とPRの監査欄を参照。
- 配布先のmain URLはマージ後に有効になる。mainからの実導入・本番反映は未実施。
