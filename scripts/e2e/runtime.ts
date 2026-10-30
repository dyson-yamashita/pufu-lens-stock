import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runnerEnvironment, type E2EMode } from './policy.ts';

export const repo = resolve(import.meta.dirname, '../..');
export const workspace = join(repo, 'packages/e2e');
export const e2eBin = join(workspace, 'node_modules/e2e/dist/cli/bin.js');
const owned = new Set<ChildProcess>();
let interrupted = false;
function checkInterrupted() {
  if (interrupted) throw new Error('E2Eを中断しました。');
}
export function child(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = repo,
  log?: (text: string) => void,
): ChildProcess {
  checkInterrupted();
  const proc = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  owned.add(proc);
  for (const stream of [proc.stdout, proc.stderr])
    stream?.on('data', (data: Buffer) => log?.(data.toString()));
  return proc;
}
export async function stop(proc: ChildProcess) {
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') proc.kill(signal);
      else if (proc.pid) process.kill(-proc.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  // リーダーが先に終了していても、所有グループの子孫を残さない。
  const running = proc.exitCode === null && proc.signalCode === null && !!proc.pid;
  const closed = running
    ? new Promise<void>((done) => proc.once('close', () => done()))
    : Promise.resolve();
  kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    closed,
    new Promise<void>((done) => {
      timer = setTimeout(done, 3000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  kill('SIGKILL');
  owned.delete(proc);
}
export async function command(args: string[], env: NodeJS.ProcessEnv, cwd = repo): Promise<string> {
  let output = '',
    overflow = false,
    timedOut = false;
  const proc = child(args, env, cwd, (text) => {
    output += text;
    if (output.length > 4 * 1024 * 1024) {
      overflow = true;
      output = output.slice(-6000);
      void stop(proc);
    }
  });
  const timer = setTimeout(
    () => {
      timedOut = true;
      void stop(proc);
    },
    10 * 60 * 1000,
  );
  try {
    const code = await new Promise<number | null>((done, reject) => {
      proc.once('error', reject);
      proc.once('close', done);
    });
    checkInterrupted();
    if (code !== 0 || overflow || timedOut)
      throw new Error(
        `E2Eコマンド失敗（exit=${code}, timeout=${timedOut}, overflow=${overflow}）\n${output.slice(-6000)}`,
      );
    return output;
  } finally {
    clearTimeout(timer);
    await stop(proc);
  }
}
export async function withRuntime<T>(
  mode: E2EMode,
  run: (url: string, env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const env = runnerEnvironment(process.env, mode);
  const scratch = await mkdtemp(join(tmpdir(), 'pufu-e2e-'));
  env.WRANGLER_LOG_PATH = join(scratch, 'wrangler.log');
  interrupted = false;
  let server: ChildProcess | undefined;
  const onSignal = () => {
    interrupted = true;
    process.exitCode = 130;
    for (const proc of owned) void stop(proc);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    console.log('E2E用アプリをビルドします。');
    await command([join(repo, 'node_modules/vite/bin/vite.js'), 'build'], env);
    const portServer = createServer();
    await new Promise<void>((done, reject) => {
      portServer.once('error', reject);
      portServer.listen(0, '127.0.0.1', done);
    });
    const address = portServer.address();
    if (!address || typeof address === 'string')
      throw new Error('ローカルポートを確保できません。');
    const port = address.port;
    await new Promise<void>((done) => portServer.close(() => done()));
    const url = `http://127.0.0.1:${port}`;
    const built = JSON.parse(
      await readFile(join(repo, 'dist/pufu_lens_stock/wrangler.json'), 'utf8'),
    );
    const config = join(scratch, 'wrangler.json');
    await writeFile(
      config,
      JSON.stringify({
        name: 'pufu-lens-e2e',
        main: resolve(repo, 'dist/pufu_lens_stock', built.main),
        compatibility_date: '2026-07-30',
        compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
        no_bundle: true,
        rules: built.rules,
        find_additional_modules: built.find_additional_modules,
        assets: {
          binding: 'ASSETS',
          directory: join(repo, 'dist/client'),
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*', '/mcp', '/oauth/*', '/.well-known/*'],
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'stock-db',
            database_id: '00000000-0000-0000-0000-000000000000',
            migrations_dir: join(repo, 'migrations'),
          },
        ],
        r2_buckets: [{ binding: 'CONTENT', bucket_name: 'e2e-content' }],
        kv_namespaces: [{ binding: 'OAUTH_KV', id: '00000000000000000000000000000000' }],
        ratelimits: built.ratelimits,
        workflows: built.workflows,
        vars: { APP_URL: url, LOCAL_DEMO_ENABLED: 'true', AI_MODEL: 'e2e-no-ai' },
      }),
    );
    const wrangler = join(repo, 'node_modules/wrangler/bin/wrangler.js');
    const state = join(scratch, 'state');
    await command(
      [
        wrangler,
        'd1',
        'migrations',
        'apply',
        'stock-db',
        '--local',
        '--config',
        config,
        '--persist-to',
        state,
      ],
      env,
    );
    let log = '';
    server = child(
      [
        wrangler,
        'dev',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--config',
        config,
        '--persist-to',
        state,
        '--show-interactive-dev-session=false',
      ],
      env,
      repo,
      (text) => {
        log = (log + text).slice(-16000);
      },
    );
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      checkInterrupted();
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error(`E2Eサーバーの起動に失敗しました。\n${log}`);
      if (log.includes('Ready on')) {
        try {
          const response = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(1500) });
          const config = (await response.json()) as { demo?: boolean; appUrl?: string };
          if (response.ok && config.demo === true) {
            ready = true;
            break;
          }
        } catch {
          /* 起動完了まで待つ。 */
        }
      }
      await delay(100);
    }
    if (!ready) throw new Error(`E2Eサーバーが起動しませんでした。\n${log}`);
    return await run(url, { ...env, PUFU_E2E_URL: url });
  } finally {
    await Promise.all([...owned].map(stop));
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await rm(scratch, { recursive: true, force: true });
  }
}
export async function saveJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
