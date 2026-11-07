// Verify recorded bad answers against the new independent review, without regenerating them.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extractPufuFacts } from '../../server/pufu-source-facts';
import { reviewPufuWin } from '../../server/pufu-win-review';
import { elementKeys, pufuScoreSchema, type PufuContext } from '../../shared/pufu';
import type { Env } from '../../server/env';

const [archivePath, id, , profile, directory] = process.argv.slice(2);
const ids: Record<string, string> = {
  'decision-swap': 'conditions-ja-pufu-deepseek-2',
  'check-to-removal': 'conditions-ja-pufu-baseline-2',
  deduplication: 'long-tail-ja-pufu-baseline-2',
  'broken-sentence': 'conditions-en-pufu-deepseek-1',
  'missing-prohibition': 'untrusted-ja-pufu-deepseek-1',
};
if (!directory || !Object.hasOwn(ids, id) || !['baseline', 'deepseek'].includes(profile))
  throw new Error('Invalid known-error evaluation arguments');
const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
const record = archive.records.find((value: { id: string }) => value.id === ids[id]);
const fixture = archive.fixtures.find((value: { id: string }) => value.id === record.fixture);
const content =
  fixture.content +
  (fixture.repeatText ?? '').repeat(fixture.repeatCount ?? 0) +
  (fixture.tail ?? '');
const context: PufuContext = {
  task: fixture.task,
  project: { id: 'eval-project', name: fixture.title, description: '' },
  question: null,
  userMemory: null,
  projectMemory: null,
  stock: { id: 'eval-stock', title: fixture.title, note: '', summary: null, content },
};
const score = pufuScoreSchema.parse(record.final.result);
const elements = Object.fromEntries(
  elementKeys.map((key) => [key, score.elements[key].text ? [score.elements[key].text] : []]),
) as Record<(typeof elementKeys)[number], string[]>;
mkdirSync(directory, { recursive: true });
const write = (name: string, value: unknown) =>
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n');
let calls = 0;
const run: NonNullable<Env['AI']>['run'] = async (model, input) => {
  const index = calls++;
  const request = {
    index,
    stage:
      index === 0 && id === 'missing-prohibition'
        ? 'extract-known-error-facts'
        : 'review-known-error',
    model,
    input,
  };
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const file = join(directory, `${index}.response.json`);
  if (!existsSync(file)) {
    write('pending.json', { ...request, requestHash });
    process.exit(75);
  }
  const response = JSON.parse(readFileSync(file, 'utf8'));
  if (response.requestHash !== requestHash) {
    write('fatal.json', { error: 'Replay input mismatch' });
    process.exit(76);
  }
  if (response.error) throw new Error(response.error);
  return response.result;
};
try {
  const env = {
    AI: { run },
    AI_MODEL: 'test',
    AI_PUFU_MODEL:
      profile === 'baseline'
        ? '@cf/zai-org/glm-5.3-flash'
        : '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    AI_PUFU_PLAN_MODEL:
      profile === 'baseline'
        ? '@cf/moonshotai/kimi-k2.6'
        : '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  } as unknown as Env;
  const facts =
    id === 'missing-prohibition'
      ? await extractPufuFacts(env, context, fixture.language)
      : { actions: score.purposes.flatMap((p) => p.measures.map((m) => m.text)), elements };
  const result = await reviewPufuWin(env, context, facts, score, fixture.language);
  write('final.json', {
    success: true,
    calls,
    originRecord: record.id,
    rejected: result.issues.length > 0,
    result,
  });
} catch (error) {
  write('final.json', {
    success: false,
    calls,
    originRecord: record.id,
    error: error instanceof Error ? error.message : String(error),
  });
}
