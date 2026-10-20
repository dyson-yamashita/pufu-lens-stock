import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default await WebAssembly.compile(
  new Uint8Array(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))),
);
