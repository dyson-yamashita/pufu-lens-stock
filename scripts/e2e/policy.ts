import { z } from 'zod';

export type E2EMode = 'ci' | 'record' | 'bootstrap';
export type Scenario = { id: string; sources: string[] };
const ciEnabled = (value?: string) => !!value && value !== '0' && value !== 'false';

export function executionMode(requested: string | undefined, ci: string | undefined): E2EMode {
  const mode = requested ?? 'ci';
  if (!['ci', 'record', 'bootstrap'].includes(mode)) throw new Error('不明なE2E実行モードです。');
  if (ciEnabled(ci) && mode !== 'ci') throw new Error('CIでAI操作・キャッシュの記録はできません。');
  return mode as E2EMode;
}

export function runnerEnvironment(input: NodeJS.ProcessEnv, mode: E2EMode): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
  ];
  if (mode === 'record') allowed.push('CODEX_HOME', 'PUFU_E2E_CODEX_MODEL');
  return {
    ...Object.fromEntries(
      allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    ),
    ...(mode === 'ci' ? { CI: 'true' } : {}),
    PUFU_E2E_MODE: mode,
    E2E_TELEMETRY_DISABLED: '1',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  };
}

export function selectScenarios(scenarios: Scenario[], changedPaths: string[]): string[] {
  const all = () => scenarios.map(({ id }) => id);
  const common =
    /^(?:src\/(?:App|api)\.|server\/(?:api|auth|env|index)\.|shared\/|migrations\/|packages\/|scripts\/|package\.json|pnpm-|\.github\/|vite\.|vitest\.|tsconfig\.|wrangler\.|index\.html|public\/)/;
  if (changedPaths.some((path) => common.test(path))) return all();
  const relevant = changedPaths.filter((path) => /^(src|server)\//.test(path));
  if (relevant.some((path) => !scenarios.some((item) => item.sources.includes(path)))) return all();
  return scenarios
    .filter((item) => item.sources.some((path) => relevant.includes(path)))
    .map(({ id }) => id);
}

const runReportSchema = z.object({
  schemaVersion: z.literal('report-1'),
  run: z.object({
    status: z.string(),
    exitCode: z.number(),
    errors: z.array(z.unknown()),
    summary: z.object({
      selected: z.number(),
      executed: z.number(),
      passed: z.number(),
      failed: z.number(),
      interrupted: z.number(),
      flaky: z.number(),
      skipped: z.number(),
    }),
    usage: z.object({
      modelTokens: z.number().nonnegative(),
      maxModelCallsInStep: z.number().nonnegative(),
    }),
    results: z.array(
      z.object({
        titlePath: z.array(z.string()),
        targetId: z.string(),
        selected: z.boolean(),
        status: z.string(),
        attempts: z.array(z.object({ status: z.string() })),
      }),
    ),
  }),
});
export function assertRunReport(
  input: unknown,
  scenarioIds: string[],
  targets: string[],
  mode: E2EMode,
) {
  const { run } = runReportSchema.parse(input);
  if (run.status !== 'passed' || run.exitCode !== 0 || run.errors.length)
    throw new Error('E2Eが正常終了していません。');
  const expected = scenarioIds.flatMap((id) => targets.map((target) => `${id}@${target}`));
  const summary = run.summary;
  if (
    !expected.length ||
    summary.selected !== expected.length ||
    summary.executed !== expected.length ||
    summary.passed !== expected.length ||
    summary.failed ||
    summary.interrupted ||
    summary.flaky ||
    summary.skipped
  )
    throw new Error('E2Eの未実行・スキップ・失敗があります。');
  const actual = run.results
    .filter(({ selected }) => selected)
    .map((result) => {
      if (
        result.status !== 'passed' ||
        result.attempts.length !== 1 ||
        result.attempts[0].status !== 'passed'
      )
        throw new Error('E2Eの実行結果が一致しません。');
      const id = result.titlePath.join(' ').match(/\b[A-Z]+-\d{3}\b/)?.[0];
      return `${id}@${result.targetId}`;
    });
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== expected.length ||
    expected.some((key) => !actual.includes(key))
  )
    throw new Error('E2Eのシナリオ・ターゲットに不足または重複があります。');
  if (mode === 'ci' && (run.usage.modelTokens !== 0 || run.usage.maxModelCallsInStep !== 0))
    throw new Error('CIでAIが利用されました。');
}

const scenarioSchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d{3}$/),
  title: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  aspects: z.array(z.string().min(1)).min(1),
});
export function validateLedger(input: unknown, listed: unknown, sourcePaths: string[]) {
  const ledger = z.array(scenarioSchema).min(1).parse(input);
  const pairs = z
    .array(z.object({ title: z.string(), target: z.string(), disposition: z.string() }))
    .parse(listed);
  const expected = ledger.flatMap(({ id, sources }) => {
    if (sources.some((path) => !sourcePaths.includes(path)))
      throw new Error(`E2E台帳の担当ソースが存在しません: ${id}`);
    return ['desktop', 'phone'].map((target) => `${id}@${target}`);
  });
  const actual = pairs.map(({ title, target, disposition }) => {
    if (disposition !== 'run') throw new Error('E2Eのskip・未実行定義は許可しません。');
    return `${title.match(/^([A-Z]+-\d{3}) /)?.[1]}@${target}`;
  });
  if (
    new Set(expected).size !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    expected.some((key) => !actual.includes(key))
  )
    throw new Error('E2E台帳と実行可能なテストが一致しません。');
  return ledger;
}
