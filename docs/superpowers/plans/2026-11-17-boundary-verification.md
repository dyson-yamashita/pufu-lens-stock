# 未着手の境界処理形式検証 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent domain work uses dispatching-parallel-agents; integration remains sequential.

**Goal:** B01〜B12と追加候補のPush(B13)・添付入力(B14)を、実装に即した最小モデル、証明、変異検出、実経路の照合テストで継続検証する。

**Architecture:** B00を保持し、独立した境界モジュールを新しいLakeプロジェクトに配置する。モデルと実装の同値性は主張せず、各境界の前提・判定時点・保護する状態・照合テスト・未検証事項を個別仕様に記録する。

**Tech Stack:** Lean 4.36.0 (標準ライブラリのみ)、Python 3、既存Vitest/Miniflare、GitHub Actions。

**Spec:** [形式検証の方針と対象一覧](../../FORMAL_VERIFICATION.md)、ユーザー指定のMCP PoC要件と未実装対象の実装依頼。

## Global Constraints

- 製品API・認証・権限・SQLの仕様を変更しない。問題は報告と修正案にとどめる。
- 本番データ・実SNS・実Push・実AIへ通信しない。
- sorry/admit・独自公理・native_decideを使わず、成功と拒否の具体例を設ける。
- モジュールごとに安全条件を除いた変異が定理の証明を失敗させることを確認する。
- 各モデルのファイル・ID・照合テストをformal/targets.jsonへ登録する。
- 各担当は指定されたLean・変異JSON・仕様・新規テストだけ編集し、共有設定は統合担当が編集する。

## Review Focus

- 期限ちょうど・失効後の認証判定と、認証済み実行中要求の取消しを混同しない。
- プロジェクト指定なし・空の許可集合・owner違いを取り違えない。
- 再送成功が新たな書込を発生させず、異なるpayloadを成功扱いしない。
- 古い世代・キャッシュ・leaseで新しい状態を上書きしない。
- 暗号・DNS接続・外部配送・パーサーの正しさを抽象モデルの証明範囲に含めない。

## Task 1: 認証とトークン (B01/B02/B03)

- [x] 実装と既存テストを調査する。
- [x] Auth/Shortcut/Connection.lean、対応するmutations/_.json、specs/_.mdを作成する。
- [x] 許可表、期限・失効、保存先、再送、MCP設定/refreshの条件を証明する。
- [x] tests/boundary-auth-verification.test.tsで入口からDBまでの不足分を照合する。

## Task 2: MCPの操作と可視性 (B04/B05)

- [x] McpWrites/McpVisibility.leanと変異・仕様を追加する。
- [x] request_id、revision、局面追加、scope/owner/project、一覧の非漏洩を証明する。
- [x] tests/boundary-mcp-verification.test.tsで実MCP入口の不足分を照合する。

## Task 3: 公開と秘密画像リンク (B06/B07)

- [x] Publication/ImageLink.leanと変異・仕様を追加する。
- [x] 非公開・キャッシュ世代、期限・owner・現在局面を証明する。
- [x] tests/boundary-public-verification.test.tsでDB/R2を含む不足分を照合する。

## Task 4: 世代付きジョブと削除 (B08/B10)

- [x] Jobs/Deletion.leanと変異・仕様を追加する。
- [x] 古い世代の拒否、削除後の書込、cleanup世代を証明する。
- [x] tests/boundary-lifecycle-verification.test.tsでワーカー/DB/R2経路の不足分を照合する。

## Task 5: 外部通信と利用枠 (B09/B11)

- [x] Network/Quota.leanと変異・仕様を追加する。
- [x] リダイレクト先再検査と予約の条件付き遷移を証明する。
- [x] tests/boundary-network-quota-verification.test.tsで外部通信を差し替えて照合する。

## Task 6: SNSとPush (B12/B13)

- [x] Sns/Push.leanと変異・仕様を追加する。
- [x] ユーザー対応、削除後の読込拒否、秘密の応答非漏洩、配信時の再確認を証明する。
- [x] tests/boundary-social-verification.test.tsで入口からDB/送信直前まで照合する。

## Task 7: 添付入力・統合基盤 (B14)

- [x] Intake.leanと変異・仕様、tests/boundary-intake-verification.test.tsを追加する。
- [x] 各モデルの正常コンパイル後に、正確な一箇所の安全条件変異をLeanで検出するcheck.pyを作成する。
- [x] root import、登録表、README、対象一覧を全対象に更新し、登録/変異機構を検査する。
- [x] 全モデルのビルド、公理監査、変異検出、関連TSテスト、型/lint/書式/E2E整合性を実行する。
- [x] scoped security-auditと独立した全差分レビューを実施し、指摘を修正・再検証する。
- [ ] commit/push/main宛PR作成、CI結果と証明・照合・未検証の区別を報告する。
