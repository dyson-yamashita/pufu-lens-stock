import type { StepExecutor, StepExecutorContext, ExecutorNode } from 'e2e';
import { codexAction } from './codex.ts';

export const goals = {
  stock: '「記事をストック」を押して、新しいストックの入力画面を開いてください。',
  editor: '「編集する」を押して、プ譜の編集画面を開いてください。',
  publish: '公開前の確認画面にある3つの確認項目すべてにチェックを入れ、「OK」を押してください。',
} as const;

function nodes(root?: ExecutorNode): ExecutorNode[] {
  return root ? [root, ...(root.children ?? []).flatMap(nodes)] : [];
}

export const denyAI: StepExecutor = {
  name: 'no-ai-replay-only',
  version: '1',
  cache: 'inherit',
  async runStep() {
    return {
      status: 'blocked',
      errorCode: 'AUTOMATION_UNSUPPORTED',
      summary: 'CIはAIを起動しません。操作を記録・更新して再実行してください。',
    };
  },
};

// 初期記録を再現可能に作るための明示的なローカル専用モード。
// e2e自身の記録APIを通して実画面を操作し、テストのexpectが通った記録だけを保存する。
export const bootstrap: StepExecutor = {
  name: 'deterministic-bootstrap',
  version: '1',
  cache: 'inherit',
  async runStep(ctx) {
    if (process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0')
      throw new Error('CIで初期キャッシュを生成できません。');
    const find = async (role: string, name: string) => {
      const observation = await ctx.observe({ tree: true });
      const matches = nodes(observation.tree).filter(
        (node) => node.role === role && node.name === name,
      );
      if (matches.length !== 1) throw new Error(`操作対象が一意ではありません: ${role} ${name}`);
      return { id: matches[0].id };
    };
    if (ctx.step.instruction === goals.stock)
      await ctx.actions.tap(await find('button', '記事をストック'));
    else if (ctx.step.instruction === goals.editor)
      await ctx.actions.tap(await find('button', '編集する'));
    else if (ctx.step.instruction === goals.publish) {
      const { tree } = await ctx.observe({ tree: true });
      const checks = nodes(tree).filter((node) => node.role === 'checkbox');
      if (checks.length !== 3) throw new Error('公開確認の3項目を取得できませんでした。');
      for (const check of checks)
        await ctx.actions.check(await find('checkbox', check.name ?? ''), true);
      await ctx.actions.tap(await find('button', 'OK'));
    } else throw new Error('未登録の初期記録操作です。');
    return { status: 'passed', summary: '実画面で操作しました。後続のexpectで検証します。' };
  },
};

export const codexExecutor: StepExecutor = {
  name: 'codex-cli',
  version: '1',
  cache: 'inherit',
  async runStep(ctx: StepExecutorContext) {
    if (process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0')
      throw new Error('CIでCodexを起動できません。');
    if (ctx.step.kind !== 'act')
      return {
        status: 'blocked',
        errorCode: 'AUTOMATION_UNSUPPORTED',
        summary: '合否はexpectで確認してください。',
      };
    for (let turn = 0; turn < ctx.budgets.maxModelCalls; turn++) {
      const screen = await ctx.observe({ tree: true });
      ctx.budgets.recordModelCall({
        provider: 'codex-cli',
        modelId: process.env.PUFU_E2E_CODEX_MODEL ?? 'codex-default',
      });
      const action = await codexAction(
        ctx.step.instruction,
        screen.text,
        ctx.signal,
        ctx.budgets.remainingMs(),
      );
      if (action.kind === 'complete')
        return {
          status: 'passed',
          summary: 'Codexの操作が完了しました。後続のexpectで検証します。',
        };
      if (!nodes(screen.tree).some((node) => node.id === action.id))
        throw new Error('Codexが現在の画面にない操作対象を返しました。');
      const target = { id: action.id };
      switch (action.kind) {
        case 'tap':
          await ctx.actions.tap(target);
          break;
        case 'type':
          await ctx.actions.type(target, action.value);
          break;
        case 'check':
          await ctx.actions.check(target, action.checked);
          break;
        case 'select':
          await ctx.actions.select(target, action.value);
          break;
        case 'press':
          await ctx.actions.press(target, action.value);
          break;
      }
    }
    return {
      status: 'blocked',
      errorCode: 'AUTOMATION_UNSUPPORTED',
      summary: 'Codexの操作回数上限です。',
    };
  },
};
