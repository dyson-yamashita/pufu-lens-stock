import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  productionAppUrl,
  productionResourceIds,
  searchIndexName,
} from '../scripts/production-config';

describe('任意の検索インデックス名', () => {
  it('未指定なら既存環境を維持し、設定済みの環境別名を使う', () => {
    expect(searchIndexName(undefined)).toBeUndefined();
    expect(searchIndexName('')).toBeUndefined();
    expect(searchIndexName('pufu-search-production')).toBe('pufu-search-production');
    expect(() => searchIndexName('https://private.example/secret')).toThrow('VECTORIZE_INDEX_NAME');
    expect(() => searchIndexName('x'.repeat(65))).toThrow('VECTORIZE_INDEX_NAME');
  });
});

describe('本番の workers.dev 公開', () => {
  it('本番の stock Worker で workers.dev と preview URL を無効のままにする', async () => {
    const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const production = source.match(/"production"\s*:\s*\{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
    expect(production).toMatch(/"workers_dev"\s*:\s*false\b/);
    expect(production).toMatch(/"preview_urls"\s*:\s*false\b/);
    expect(production).not.toMatch(/"workers_dev"\s*:\s*true\b/);
    expect(production).not.toMatch(/"preview_urls"\s*:\s*true\b/);
  });
});

describe('production APP_URL', () => {
  it('normalizes an HTTPS origin for OAuth callback URL concatenation', () => {
    expect(productionAppUrl('https://Stock.example.com/')).toBe('https://stock.example.com');
    expect(productionAppUrl('https://stock.example.com:8443')).toBe(
      'https://stock.example.com:8443',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'http://stock.example.com',
    'https://app.example.invalid',
    'https://localhost',
    'https://demo.localhost',
    'https://user:password@stock.example.com',
    'https://stock.example.com/app',
    'https://stock.example.com/?token=private',
    'https://stock.example.com/#fragment',
  ])('rejects an unusable production origin without echoing its value: %s', (value) => {
    expect(() => productionAppUrl(value)).toThrow('APP_URL');
    if (value) expect(() => productionAppUrl(value)).not.toThrow(value);
  });
});

describe('production resource IDs', () => {
  const valid = {
    D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
    OAUTH_KV_ID: '11111111111111111111111111111111',
  };

  it('keeps the configured D1 and OAuth KV IDs', () => {
    expect(productionResourceIds(valid)).toEqual({
      databaseId: '11111111-1111-4111-8111-111111111111',
      oauthKvId: '11111111111111111111111111111111',
    });
  });

  it.each<[keyof typeof valid, string | undefined]>([
    ['D1_DATABASE_ID', undefined],
    ['D1_DATABASE_ID', 'not-a-database-id'],
    ['D1_DATABASE_ID', '00000000-0000-0000-0000-000000000000'],
    ['OAUTH_KV_ID', undefined],
    ['OAUTH_KV_ID', 'not-a-namespace-id'],
    ['OAUTH_KV_ID', '00000000000000000000000000000000'],
  ])('rejects missing, malformed or placeholder %s before deployment', (name, value) => {
    expect(() => productionResourceIds({ ...valid, [name]: value })).toThrow(name);
  });
});
