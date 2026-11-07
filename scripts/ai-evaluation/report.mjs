import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';

const [directory, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: report.mjs exchangeDirectory output.json');
const prices = {
  '@cf/qwen/qwen3-30b-a3b-fp8': [0.0509, 0.335],
  '@cf/google/gemma-4-26b-a4b-it': [0.1, 0.3],
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': [0.3, 1.2],
  '@cf/zai-org/glm-5.3-flash': [0.15, 0.5],
  '@cf/moonshotai/kimi-k2.6': [0.95, 4],
};
const fixtureBytes = readFileSync(new URL('./fixtures.json', import.meta.url));
const fixtures = JSON.parse(fixtureBytes);
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const records = readdirSync(directory)
  .sort()
  .map((id) => {
    const match =
      /^(conditions-ja|conditions-en|untrusted-ja|long-tail-ja)-(summary|memory|pufu)-(baseline|gemma|deepseek)-([12])$/.exec(
        id,
      );
    if (!match) throw new Error(`Unexpected run: ${id}`);
    const [, fixture, kind, profile, repeat] = match;
    const root = join(directory, id);
    const final = read(join(root, 'final.json'));
    const calls = Array.from({ length: final.calls }, (_, index) => {
      const request = read(join(root, `${index}.request.json`));
      const response = read(join(root, `${index}.response.json`));
      const { requestHash: storedHash, ...hashedRequest } = request;
      const hash = createHash('sha256').update(JSON.stringify(hashedRequest)).digest('hex');
      if (hash !== storedHash || hash !== response.requestHash)
        throw new Error(`Request hash mismatch: ${id}/${index}`);
      const usage = response.result?.usage;
      const price = prices[request.model];
      if (!price) throw new Error(`No pricing snapshot for ${request.model}`);
      const settings = Object.fromEntries(
        Object.entries(request.input).filter(
          ([key]) => !['messages', 'response_format'].includes(key),
        ),
      );
      return {
        index,
        stage: request.stage,
        model: request.model,
        requestHash: hash,
        requestSettings: settings,
        responseFormatSHA256: createHash('sha256')
          .update(JSON.stringify(request.input.response_format))
          .digest('hex'),
        elapsedMs: response.elapsedMs,
        responseContentChars: response.responseContentChars,
        responseReasoningChars: response.responseReasoningChars,
        usage: usage ?? null,
        uncachedUSD: usage
          ? (usage.prompt_tokens * price[0] + usage.completion_tokens * price[1]) / 1e6
          : null,
        response,
      };
    });
    return { id, fixture, kind, profile, repeat: Number(repeat), final, calls };
  });
writeFileSync(
  output,
  JSON.stringify(
    {
      date: '2026-11-07',
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        encoding: 'utf8',
      }).trim(),
      fixtureSHA256: createHash('sha256').update(fixtureBytes).digest('hex'),
      fixtures,
      pricesPerMillionTokens: prices,
      method:
        'Production generation functions with file-exchanged Workers AI REST results. Repetition numbers are recorded for each fixture/profile; temperature 0.2. No transport retry. Costs use uncached list prices; unknown usage stays null. API time excludes tool/local/scheduler overhead. Model reasoning bodies are removed. No database or deployed binding involved.',
      records,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${records.length} completed runs archived to ${output}`);
