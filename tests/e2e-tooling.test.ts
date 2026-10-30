import { describe, expect, it } from 'vitest';
import { executionMode, runnerEnvironment, selectScenarios } from '../scripts/e2e/policy';

const scenarios = [
  { id: 'STOCK-001', sources: ['src/Stocks.tsx', 'server/stocks.ts'] },
  { id: 'PUFU-001', sources: ['src/PufuEditor.tsx', 'server/pufu.ts'] },
  { id: 'PUBLIC-001', sources: ['src/PublicationSettings.tsx', 'server/public-projects.ts'] },
];

describe('E2Eの実行ポリシー', () => {
  it.each(['true', '1'])('CI=%sではAIによる記録を拒否する', (ci) => {
    expect(() => executionMode('record', ci)).toThrow('CI');
    expect(() => executionMode('bootstrap', ci)).toThrow('CI');
    expect(executionMode(undefined, ci)).toBe('ci');
  });
  it('明示したローカル記録とCIモードだけを受け付ける', () => {
    expect(executionMode('record', undefined)).toBe('record');
    expect(executionMode('ci', undefined)).toBe('ci');
    expect(() => executionMode('unknown', undefined)).toThrow();
  });
  it('CIの子プロセスへAI認証・モデル指定・Nodeの任意コードを引き継がない', () => {
    const env = runnerEnvironment(
      {
        PATH: '/test/bin',
        HTTPS_PROXY: 'http://test-proxy.invalid:8080',
        OPENAI_API_KEY: 'dummy-openai-key',
        ANTHROPIC_API_KEY: 'dummy-anthropic-key',
        CODEX_HOME: '/dummy/private-codex',
        NODE_OPTIONS: '--require /dummy/agent.js',
        E2E_OAUTH_CREDENTIALS: 'dummy-oauth',
        PUFU_E2E_MODE: 'record',
      },
      'ci',
    );
    expect(env.PATH).toBe('/test/bin');
    expect(env.HTTPS_PROXY).toBe('http://test-proxy.invalid:8080');
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'CODEX_HOME',
      'NODE_OPTIONS',
      'E2E_OAUTH_CREDENTIALS',
    ])
      expect(env[key]).toBeUndefined();
    expect(env.PUFU_E2E_MODE).toBe('ci');
    expect(env.E2E_TELEMETRY_DISABLED).toBe('1');
  });
  it('局所的な変更は担当シナリオを選ぶ', () => {
    expect(selectScenarios(scenarios, ['src/PufuEditor.tsx'])).toEqual(['PUFU-001']);
  });
  it.each([
    'src/App.tsx',
    'src/api.ts',
    'server/api.ts',
    'server/auth.ts',
    'shared/pufu.ts',
    'packages/pufu-image/src/index.ts',
    'wrangler.jsonc',
    'vite.config.ts',
  ])('共通経路 %s の変更は全シナリオを選ぶ', (path) => {
    expect(selectScenarios(scenarios, [path])).toEqual(['STOCK-001', 'PUFU-001', 'PUBLIC-001']);
  });
  it('未分類のアプリ変更を確認対象なしとして取りこぼさない', () => {
    expect(selectScenarios(scenarios, ['src/NewFeature.tsx'])).toEqual([
      'STOCK-001',
      'PUFU-001',
      'PUBLIC-001',
    ]);
    expect(selectScenarios(scenarios, ['README.md'])).toEqual([]);
  });
});

import { assertRunReport } from '../scripts/e2e/policy';
const report = () => ({
  schemaVersion: 'report-1',
  run: {
    status: 'passed',
    exitCode: 0,
    errors: [],
    summary: {
      selected: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      interrupted: 0,
      flaky: 0,
      skipped: 0,
    },
    usage: { modelTokens: 0, maxModelCallsInStep: 0 },
    results: [
      {
        titlePath: ['STOCK-001 本文を保存する'],
        targetId: 'desktop',
        selected: true,
        status: 'passed',
        attempts: [{ status: 'passed', steps: [] }],
      },
    ],
  },
});
describe('E2Eの実行結果照合', () => {
  it('指定したシナリオとターゲットが実行済みなら通す', () => {
    expect(() => assertRunReport(report(), ['STOCK-001'], ['desktop'], 'ci')).not.toThrow();
  });
  it('合格表示でも未実行・スキップ・別ターゲットを見逃さない', () => {
    expect(() => assertRunReport(report(), ['STOCK-001'], ['desktop', 'phone'], 'ci')).toThrow();
    const skipped = report();
    skipped.run.summary.skipped = 1;
    expect(() => assertRunReport(skipped, ['STOCK-001'], ['desktop'], 'ci')).toThrow();
    const absent = report();
    absent.run.results = [];
    expect(() => assertRunReport(absent, ['STOCK-001'], ['desktop'], 'ci')).toThrow();
  });
  it('CIではAI呼び出し・モデル消費が1件でもあれば失敗にする', () => {
    const calls = report();
    calls.run.usage.maxModelCallsInStep = 1;
    expect(() => assertRunReport(calls, ['STOCK-001'], ['desktop'], 'ci')).toThrow('AI');
    const tokens = report();
    tokens.run.usage.modelTokens = 1;
    expect(() => assertRunReport(tokens, ['STOCK-001'], ['desktop'], 'ci')).toThrow('AI');
  });
  it('記録モードでAIを使うことは許可する', () => {
    const value = report();
    value.run.usage.maxModelCallsInStep = 2;
    expect(() => assertRunReport(value, ['STOCK-001'], ['desktop'], 'record')).not.toThrow();
  });
  it('壊れたレポート・重複した成功行・失敗したattemptを拒否する', () => {
    expect(() => assertRunReport({}, ['STOCK-001'], ['desktop'], 'ci')).toThrow();
    const duplicated = report();
    duplicated.run.results.push(duplicated.run.results[0]);
    expect(() => assertRunReport(duplicated, ['STOCK-001'], ['desktop'], 'ci')).toThrow();
    const failed = report();
    failed.run.results[0].attempts[0].status = 'failed';
    expect(() => assertRunReport(failed, ['STOCK-001'], ['desktop'], 'ci')).toThrow();
  });
});

import { validateLedger } from '../scripts/e2e/policy';
const ledger = [
  { id: 'STOCK-001', title: '保存', sources: ['src/App.tsx'], aspects: ['再読込後も残る'] },
];
const pairs = () =>
  ['desktop', 'phone'].map((target) => ({
    title: 'STOCK-001 保存する',
    target,
    disposition: 'run',
  }));
describe('E2E台帳と実行可能なテストの照合', () => {
  it('全シナリオが両方の画面幅で実行可能なら通す', () => {
    expect(() => validateLedger(ledger, pairs(), ['src/App.tsx'])).not.toThrow();
  });
  it('未登録・重複・片方だけのテスト・skipを拒否する', () => {
    expect(() => validateLedger(ledger, pairs().slice(0, 1), ['src/App.tsx'])).toThrow();
    expect(() => validateLedger(ledger, [...pairs(), pairs()[0]], ['src/App.tsx'])).toThrow();
    expect(() =>
      validateLedger(
        ledger,
        [...pairs(), { title: 'NEW-001 新機能', target: 'desktop', disposition: 'run' }],
        ['src/App.tsx'],
      ),
    ).toThrow();
    expect(() =>
      validateLedger(
        ledger,
        pairs().map((pair) => ({ ...pair, disposition: 'skip' })),
        ['src/App.tsx'],
      ),
    ).toThrow();
  });
  it('存在しない担当ソース・空の検証観点・重複IDを拒否する', () => {
    expect(() => validateLedger(ledger, pairs(), [])).toThrow();
    expect(() =>
      validateLedger([{ ...ledger[0], aspects: [] }], pairs(), ['src/App.tsx']),
    ).toThrow();
    expect(() => validateLedger([...ledger, ledger[0]], pairs(), ['src/App.tsx'])).toThrow();
  });
});

import { parseAction, codexAction } from '../packages/e2e/src/codex';
import { vi } from 'vitest';
describe('Codexの操作境界', () => {
  it('限定したJSON操作だけを受け付ける', () => {
    expect(parseAction({ kind: 'tap', id: 'n12', value: '', checked: false }).kind).toBe('tap');
    expect(() =>
      parseAction({ kind: 'shell', id: 'n12', value: 'command', checked: false }),
    ).toThrow();
    expect(() =>
      parseAction({ kind: 'tap', id: 'n12', value: '', checked: false, command: 'extra' }),
    ).toThrow();
    expect(() =>
      parseAction({ kind: 'type', id: 'n12', value: 'a'.repeat(4001), checked: false }),
    ).toThrow();
  });
  it('recordを直接指定してもCIではCodexを起動しない', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('PUFU_E2E_MODE', 'record');
    try {
      await expect(
        codexAction('dummy goal', 'dummy screen', new AbortController().signal, 100),
      ).rejects.toThrow('ローカル');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
