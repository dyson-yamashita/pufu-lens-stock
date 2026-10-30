import { resolve } from 'node:path';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { executionMode } from '../../scripts/e2e/policy.ts';
import { bootstrap, codexExecutor, denyAI } from './src/executor.ts';

const mode = executionMode(process.env.PUFU_E2E_MODE, process.env.CI);
const url = process.env.PUFU_E2E_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
  throw new Error('専用のローカルE2Eランナーから実行してください。');
export default {
  tests: 'tests/**/*.e2e.ts',
  timeout: mode === 'record' ? 180000 : 60000,
  workers: 1,
  retries: 0,
  output: process.env.PUFU_E2E_OUTPUT ?? '.e2e/results',
  reporters: ['list'],
  trace: 'retain-on-failure',
  cache: {
    mode: mode === 'ci' ? 'read-only' : 'read-write',
    strict: mode === 'ci',
    dir: resolve(import.meta.dirname, 'recordings'),
  },
  agents: {
    default: {
      executor: mode === 'record' ? codexExecutor : mode === 'bootstrap' ? bootstrap : denyAI,
      maxSteps: 12,
      maxModelCalls: 8,
      context: 'Pufu Lens local fixture UI; verify every outcome with expect.',
    },
  },
  targets: [
    {
      name: 'desktop',
      engine: web({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } }),
      app: { url, identity: 'pufu-lens-e2e' },
    },
    {
      name: 'phone',
      engine: web({ locale: 'ja-JP', viewport: { width: 390, height: 844 } }),
      app: { url, identity: 'pufu-lens-e2e' },
    },
  ],
} satisfies E2EConfig;
