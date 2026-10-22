# プ譜の画像・編集モーダル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通常画面は画像を中心に表示し、拡大閲覧と編集を別のモーダルで行う。

**Architecture:** 既存の保存済みSVGと局面管理を再利用する。ネイティブdialogを共通のプ譜用コンポーネントで開き、画像の拡大・移動はPointer Events、編集は既存ProjectScoreを利用する。

**Tech Stack:** React 19、TypeScript、SVG、Pointer Events、HTML dialog、Vitest / LinkeDOM。

**Spec:** この文書の要件（ユーザーの追加依頼）。

## 要件 / Global Constraints

- 画像の枠と画像上の説明文を削除する。
- 画像は「現在の内容を保存して次の局面へ引き継ぎます。」の説明文の下へ置く。
- 画像を押すとモーダルを開き、ピンチイン・アウトで拡大縮小できる。
- 画像右下の「編集する」でエディターをモーダル表示する。通常画面にはエディターを表示しない。
- 保存・局面切り替え・局面追加・JSON出力を維持し、保存済みスコアと編集用スコアの参照を分離する。
- 新しい依存は追加せず、既存PR #95を更新する。マージ・本番反映は行わない。

## Review Focus

- 未保存のまま閉じる/Escape：確認を拒否すれば編集を保持し、破棄した後は保存済み内容で再開する。
- 保存失敗・保存中：編集内容を失わず、保存中は閉じない。
- 通常画面での局面追加・JSON出力：未マウントのEditorのストアに依存しない。
- 複数の指の離脱・pointercancel：拡大率を1〜6倍に制限し、操作を再開できる。
- スマホ・キーボード・画像生成失敗：閉じる操作と編集への導線を維持する。

## Task 1: 画像中心の表示と編集モーダル

**Files:** `src/PufuEditor.tsx`、`src/PufuImagePreview.tsx`、新規 `src/PufuModal.tsx`、`src/styles.css`、`tests/public-score-ui.test.ts`。

**Interfaces:** `PufuImagePreview({ score, phase, onEdit })`。`PufuModal({ title, children, onClose, busy? })` は閉じる要求を呼出元へ渡す。

- [ ] 既存UIテストを通常表示・編集モーダル・保存/破棄/再開・保存失敗・局面追加に更新し、未実装のため失敗することを確認する。
- [ ] 通常画面で保存済みスコアを使い、画像を説明文の下へ置く。編集時だけProjectScoreをマウントする。
- [ ] 編集モーダルの保存・未保存確認・保存中の閉じる制限を実装し、関連テストを成功させる。

## Task 2: 画像モーダルと完了検証

**Files:** 新規 `src/PufuImageModal.tsx`、`src/PufuImagePreview.tsx`、`src/styles.css`、新規 `tests/pufu-image-modal-ui.test.ts`、`src/UserManual.tsx`、`docs/DESIGN.md`、`docs/SPEC.md`。

**Interfaces:** `PufuImageModal({ image, phase, onClose })` はエスケープ済みSVGを受け取り、1〜6倍の拡大・移動を行う。

- [ ] 画像を押して開閉、拡大縮小・リセット、2点タッチ、pointercancel、キーボードのテストを追加し、失敗を確認する。
- [ ] SVGを全体表示し、ピンチの中心を保った拡大とドラッグ移動、操作ボタンを実装する。
- [ ] マニュアルの編集入口・画像閲覧の説明と、画面/API仕様の関連説明を更新する。
- [ ] 関連テスト、typecheck、lint、Prettier、全体テスト（`--maxWorkers=1`）、buildを実行する。
- [ ] ブラウザーでスマホ・PC、ピンチ、編集/保存/閉じる、マニュアル表示を確認する。
- [ ] 独立した読み取り専用レビューを完了し、必要な修正を検証後、コミット・pushしてPR #95を更新する。
