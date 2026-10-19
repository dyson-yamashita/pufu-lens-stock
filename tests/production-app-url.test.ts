import { describe, expect, it } from 'vitest';
import { productionAppUrl } from '../scripts/production-app-url';

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
