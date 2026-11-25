import { createHash, randomUUID } from 'node:crypto';
import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { productionAppUrl } from './production-config.ts';

const day = 24 * 60 * 60 * 1000;
const maxFiles = 20_000;
const maxBytes = 25 * 1024 * 1024;
const hashed =
  /^[\w.-]+-[\w-]{8}\.(?:js|css|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Entry = { name: string; sha256: string; expires: number | 'cutover' | null };
type ActiveRelease = { hash: string | null; deployedAt: number };
export function releaseDigest(bindings: { name: string; type: string; text?: string }[]) {
  const binding = bindings.find(({ name }) => name === 'PUFU_ASSET_RELEASE_SHA256');
  if (!binding) return null; // A version deployed before retention was introduced.
  if (
    binding.type !== 'plain_text' ||
    typeof binding.text !== 'string' ||
    !/^[a-f0-9]{64}$/.test(binding.text)
  )
    throw new Error('Invalid release digest');
  return binding.text;
}

function activeRelease(config: string): ActiveRelease {
  const read = (...args: string[]) =>
    JSON.parse(
      execFileSync('wrangler', [...args, '--config', config, '--json'], { encoding: 'utf8' }),
    );
  const deployment = read('deployments', 'status');
  const [active] = deployment.versions;
  const deployedAt = Date.parse(deployment.created_on);
  if (
    deployment.versions.length !== 1 ||
    active.percentage !== 100 ||
    !/^[0-9a-f-]{36}$/i.test(active.version_id) ||
    !Number.isFinite(deployedAt)
  ) {
    throw new Error('Expected a single fully deployed production version');
  }
  const version = read('versions', 'view', active.version_id);
  if (version.id !== active.version_id) throw new Error('Active Worker version mismatch');
  return { hash: releaseDigest(version.resources.bindings), deployedAt };
}

async function get(origin: string, path: string, limit = maxBytes) {
  const url = new URL(path, origin);
  url.searchParams.set('release-check', randomUUID());
  const response = await fetch(url, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200 || !response.body) throw new Error(`Unavailable: ${path}`);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`Oversized: ${path}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function liveEntries(origin: string, hash: string | null): Promise<Entry[]> {
  // Versions deployed before retention was introduced have no archive.
  if (hash === null) return [];
  const bytes = await get(origin, `/release-${hash}.json`);
  if (digest(bytes) !== hash) throw new Error('Release index digest mismatch');
  const entries = JSON.parse(bytes.toString());
  if (!Array.isArray(entries) || entries.length > maxFiles)
    throw new Error('Invalid release index');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      !hashed.test(entry.name) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      seen.has(entry.name) ||
      (entry.expires !== null &&
        entry.expires !== 'cutover' &&
        !Number.isSafeInteger(entry.expires))
    ) {
      throw new Error('Invalid release entry');
    }
    seen.add(entry.name);
  }
  return entries;
}

export async function prepareRelease(
  client: string,
  output: string,
  origin: string,
  active: ActiveRelease,
  now = Date.now(),
) {
  // Start from a fresh copy of this build on every attempt, including retries.
  await cp(client, output, { recursive: true, dereference: true });
  const assets = join(output, 'assets');
  const current = new Map<string, Entry>();
  for (const file of await readdir(assets, { withFileTypes: true })) {
    if (!file.isFile() || !hashed.test(file.name))
      throw new Error(`Unexpected Vite output: ${file.name}`);
    current.set(file.name, {
      name: file.name,
      sha256: digest(await readFile(join(assets, file.name))),
      expires: null,
    });
  }
  if (!current.size) throw new Error('Missing Vite output');
  for (const old of await liveEntries(origin, active.hash)) {
    const existing = current.get(old.name);
    if (existing) {
      if (existing.sha256 !== old.sha256) throw new Error(`Asset collision: ${old.name}`);
      continue;
    }
    // 'cutover' is resolved using the actual activation time of the live deployment.
    const expires = old.expires === 'cutover' ? active.deployedAt + day : old.expires;
    if (expires !== null && expires < now) continue;
    const bytes = await get(origin, `/assets/${old.name}`);
    if (digest(bytes) !== old.sha256) throw new Error(`Asset digest mismatch: ${old.name}`);
    await writeFile(join(assets, old.name), bytes, { flag: 'wx' });
    current.set(old.name, { ...old, expires: expires ?? 'cutover' });
  }
  const manifest = Buffer.from(JSON.stringify([...current.values()]));
  const hash = digest(manifest);
  await writeFile(join(output, `release-${hash}.json`), manifest, { flag: 'wx' });
  let count = 0;
  for (const file of await readdir(output, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    if (++count > maxFiles || (await stat(join(file.parentPath, file.name))).size > maxBytes)
      throw new Error('Workers static asset limit exceeded');
  }
  return hash;
}

if (import.meta.main) {
  const configPath = 'dist/pufu_lens_stock/wrangler.json';
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const origin = productionAppUrl(config.vars?.APP_URL);
  const output = process.argv[2];
  if (!output) throw new Error('Missing release staging directory');
  const hash = await prepareRelease('dist/client', output, origin, activeRelease(configPath));
  console.log(hash);
}
