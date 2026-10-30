# Privacy onboarding implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Googleのメール・名前を使わず、ニックネームと明示的な同意を登録してから利用できるようにする。

**Architecture:** Googleのsubと既存ユーザーIDを維持し、D1に初回利用登録の完了日時と同意文書の版を記録する。Reactの登録画面とサーバーの利用制限でWeb・API・MCPの開始条件を統一する。

**Tech Stack:** React 19, TypeScript, Hono, Cloudflare D1/KV, openid-client, Vitest/Miniflare/linkedom.

**Spec:** `docs/superpowers/specs/2026-10-30-privacy-onboarding-design.md`

## Global Constraints

- 既存依存・配色・テスト基盤を使い、本番デプロイやマージをしない。
- メールの列を削除し、旧表示名とGoogleプロフィール画像を空にする。コンテンツと内部IDは保持する。
- 未同意の再ログインでも登録画面を表示し、通常API・MCPの利用を拒否する。
- 自由入力された本文の個人情報と過去の外部ログ・バックアップは対象外。

## Review Focus

- メール・名前なしのIDトークンと、以前の権限で余分なclaimsを返すIDトークンの両方。
- 既存セッション・APIトークン・MCP認可を使った初回登録の回避。
- 部分的な同意、空白の名前、別Origin、完了後の重複送信。
- ログアウト・再ログイン・画面更新による未完了フォームの復帰。
- 旧スキーマの移行と、既存コンテンツ・外部連携の保持。

### Task 1: 認証情報の最小化と同意の永続化

**Files:** migrations/0033_privacy_onboarding.sql（番号は既存の最終番号に続ける）、shared/domain.ts、shared/legal.ts、server/auth.ts、server/api.ts、server/mcp.ts、server/mcp-oauth.ts、server/demo.ts、tests/helpers.ts、tests/oauth.test.ts、tests/onboarding.test.ts。

**Interfaces:** `User` からemailを除き `onboarding_completed_at: string | null` を追加。`onboardingSchema` はname・terms_accepted・privacy_accepted・terms_version・privacy_version。`POST /api/v1/onboarding` は `{ user: User, redirect_to: string | null }` を返す。`legalVersions` で文書の版を共有。

- [ ] RED: OAuthテストでscopeがopenid、名前・メールなしでも認証、余分なclaimsを保存しないことを検証。初回のuserは `{name:'', onboarding_completed_at:null}`、emailキーなし。
- [ ] RED: 未完了の通常API・MCP拒否、同意不足・別Origin・Bearer拒否、OKの永続化・再ログイン・冪等再送、移行時のメール列削除とコンテンツ保持をテストする。
- [ ] `pnpm test tests/oauth.test.ts tests/onboarding.test.ts` を実行し未実装により失敗することを確認する。
- [ ] 最小のマイグレーション・認証・同意API・アクセス制限と固定コードのエラーログを実装。既存テストの正規ユーザーfixtureは同意済みにし、旧スキーマ移行テストは必要な列を移行する。
- [ ] 同コマンドがPASSし、関連するprofile・MCPテストもPASSすることを確認してコミット。

### Task 2: 初回利用画面と説明の更新

**Files:** src/Onboarding.tsx、src/App.tsx、src/Profile.tsx、src/styles.css、src/LegalPage.tsx、src/UserManual.tsx、docs/SPEC.md、tests/onboarding-ui.test.ts、既存UIテストのUser fixture。

**Interfaces:** `Onboarding({onComplete,onLogout})` は登録APIのuserをAppに返す。Appは `onboarding_completed_at` がない間登録画面だけを表示し通常APIを呼ばない。登録後はredirect_toがある場合MCP認可を再開。

- [ ] RED: 名前と同意が揃うまで送信できず、送信成功時にのみアプリへ進むこと、失敗時は再試行できること、未完了の再マウントで登録画面になることをテストする。
- [ ] `pnpm test tests/onboarding-ui.test.ts` の想定した失敗を確認する。
- [ ] 既存スタイルを再利用して登録フォーム・Appのゲート・メール表示削除を実装し、文書とマニュアルを更新する。
- [ ] 同コマンドがPASSすることを確認。`pnpm run check` とローカルの登録・プロフィール・規約・マニュアルの表示を確認しコミット。

### Task 3: 監査・レビュー・PR

**Files:** 全差分。

**Interfaces:** 最新origin/mainとの共通祖先から全変更（未追跡含む）を対象。

- [ ] standard scoped security-auditを実施し、指摘があれば回帰テストと修正・再監査。
- [ ] 独立エージェントへ読み取り専用の変更全体レビューを依頼。必要な修正後に再検証・再レビュー。
- [ ] 作業ブランチをpushしmain向けPR作成。検証・監査範囲と結果・未確認事項・レビュー結果を記載する。
