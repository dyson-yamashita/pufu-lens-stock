import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRelease, releaseDigest } from '../scripts/retain-assets';

const origin = 'https://app.test';
const root = await mkdtemp(join(tmpdir(), 'release-assets-'));
const old = 'lazy-Abcd1234.js';
const shared = 'font-Cdef5678.woff2';
const html =
  '<html lang="ja"><head><title>Pufu Lens</title></head><body>Pufu Lens<div id="root"></div><script src="/assets/index-Abcd1234.js"></script></body></html>';
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it('世代交代後24時間は全依存を保持し、期限を更新せず、衝突・欠損は配信前に拒否する', async () => {
  const build = join(root, 'build');
  const assets = join(build, 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(join(build, 'index.html'), html);
  await writeFile(join(build, 'theme.js'), 'A theme');
  await writeFile(join(assets, old), 'lazy A');
  await writeFile(join(assets, shared), 'font');
  let live = build;
  let active: { hash: string | null; deployedAt: number } = { hash: null, deployedAt: 0 };
  vi.stubGlobal('fetch', async (url: URL) => {
    const path = url.pathname === '/' ? 'index.html' : url.pathname;
    try {
      return new Response(await readFile(join(live, path)));
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  const deploy = async (release: string, now: number) => {
    const next = join(root, release);
    const hash = await prepareRelease(build, next, origin, active, now);
    active = { hash, deployedAt: now };
    live = next;
  };
  await deploy('A', 0);
  const hour = 3600000;
  await writeFile(join(assets, old), 'collision');
  await expect(deploy('collision', 200 * hour)).rejects.toThrow('collision');
  await rm(join(assets, old));
  await rm(join(build, 'theme.js'));
  await deploy('B', 200 * hour);
  await expect(readFile(join(live, 'theme.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  const b = live;
  live = join(root, 'A');
  await expect(deploy('stale-edge', 222 * hour)).rejects.toThrow('Unavailable');
  live = b;
  await deploy('C', 223 * hour);
  expect(await readFile(join(live, 'assets', old), 'utf8')).toBe('lazy A');
  await writeFile(join(live, 'assets', old), 'corrupt');
  await expect(deploy('corrupt', 224 * hour)).rejects.toThrow('digest mismatch');
  await deploy('D', 225 * hour);
  await expect(readFile(join(live, 'assets', old))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(live, 'assets', shared), 'utf8')).toBe('font');
});

it('シークレット更新で複製された版でも継承された公開ダイジェストを読み取る', () => {
  const digest = 'a'.repeat(64);
  const binding = { name: 'PUFU_ASSET_RELEASE_SHA256', type: 'plain_text', text: digest };
  expect(releaseDigest([{ name: 'ROTATED', type: 'secret_text' }, binding])).toBe(digest);
  expect(releaseDigest([])).toBeNull();
  expect(() => releaseDigest([{ ...binding, text: '' }])).toThrow('Invalid release digest');
});
