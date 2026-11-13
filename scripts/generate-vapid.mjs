import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

// Keys stay in an ignored directory. Never print them or place them in CLI arguments.
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
  'base64url',
);
await mkdir('secrets', { recursive: true, mode: 0o700 });
await writeFile('secrets/vapid-public-key.txt', publicKey, { mode: 0o600, flag: 'wx' });
await writeFile('secrets/vapid-private-key.txt', privateKey.d, { mode: 0o600, flag: 'wx' });
console.log(
  'VAPID鍵をsecrets/vapid-public-key.txtとsecrets/vapid-private-key.txtへ保存しました。既存ファイルは上書きしません。',
);
