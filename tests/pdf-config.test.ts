import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

describe('PDF専用Workerのローカル権限', () => {
  it.each([undefined, 'production'])(
    '.dev.varsのアプリ用秘密情報を解析Workerへ渡さない（環境: %s）',
    async (env) => {
      const directory = await mkdtemp(join(tmpdir(), 'pdf-worker-config-'));
      try {
        const config = await readFile(new URL('../wrangler.pdf.jsonc', import.meta.url), 'utf8');
        const path = join(directory, 'wrangler.pdf.jsonc');
        await writeFile(path, config);
        await writeFile(
          join(directory, '.dev.vars'),
          'GOOGLE_CLIENT_SECRET=sentinel-google\nINTEGRATION_ENCRYPTION_KEY=sentinel-encryption\n',
        );
        const { workerOptions } = unstable_getMiniflareWorkerOptions(path, env);
        expect(workerOptions.bindings ?? {}).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
        expect(workerOptions.bindings ?? {}).not.toHaveProperty('INTEGRATION_ENCRYPTION_KEY');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
