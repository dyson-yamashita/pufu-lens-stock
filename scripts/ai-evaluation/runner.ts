// File exchange keeps authentication outside the evaluator. No network or database writes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { summarize, buildMemory } from '../../server/ai';
import { generatePufu } from '../../server/pufu';
import type { Env } from '../../server/env';
import type { Language } from '../../shared/locale';

const [fixtureFile, fixtureId, kind, profile, directory] = process.argv.slice(2);
if (!directory || !['summary', 'memory', 'pufu'].includes(kind))
  throw new Error(
    'Usage: runner fixtures.json fixtureId summary|memory|pufu baseline|gemma|deepseek exchangeDirectory',
  );
const fixtures = JSON.parse(readFileSync(fixtureFile, 'utf8')) as {
  id: string;
  language: Language;
  title: string;
  task: string;
  content: string;
  repeatText?: string;
  repeatCount?: number;
  tail?: string;
}[];
const fixture = fixtures.find(({ id }) => id === fixtureId);
if (!fixture) throw new Error('Unknown fixture');
const models: Record<string, string> = {
  baseline: '@cf/qwen/qwen3-30b-a3b-fp8',
  gemma: '@cf/google/gemma-4-26b-a4b-it',
  deepseek: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
};
if (!models[profile]) throw new Error('Unknown profile');
const content =
  fixture.content +
  (fixture.repeatText ?? '').repeat(fixture.repeatCount ?? 0) +
  (fixture.tail ?? '');
mkdirSync(directory, { recursive: true });
const write = (name: string, value: unknown) =>
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n');
let index = 0;
let stage = kind;
const run: NonNullable<Env['AI']>['run'] = async (model, input) => {
  const current = index++;
  const request = { index: current, stage, model, input };
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const responseFile = join(directory, `${current}.response.json`);
  if (existsSync(responseFile)) {
    const response = JSON.parse(readFileSync(responseFile, 'utf8'));
    if (response.requestHash !== requestHash) {
      write('fatal.json', { error: 'Replay input mismatch', index: current });
      process.exit(76);
    }
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  write('pending.json', { ...request, requestHash });
  process.exit(75);
};
const env = {
  AI: { run },
  AI_MODEL: models[profile],
  AI_PUFU_MODEL: profile === 'baseline' ? '@cf/zai-org/glm-5.3-flash' : models[profile],
  AI_PUFU_PLAN_MODEL: profile === 'baseline' ? '@cf/moonshotai/kimi-k2.6' : models[profile],
} as unknown as Env;
const summary = { overview: content, keyPoints: [content], topics: ['運用'] };
try {
  const result =
    kind === 'pufu'
      ? await generatePufu(
          env,
          {
            task: fixture.task,
            project: { id: 'eval-project', name: fixture.title, description: '' },
            question: null,
            userMemory: null,
            projectMemory: null,
            stock: { id: 'eval-stock', title: fixture.title, note: '', summary: null, content },
          },
          fixture.language,
          async (name, operation) => {
            stage = name;
            return operation({
              task: fixture.task,
              project: { id: 'eval-project', name: fixture.title, description: '' },
              question: null,
              userMemory: null,
              projectMemory: null,
              stock: { id: 'eval-stock', title: fixture.title, note: '', summary: null, content },
            });
          },
        )
      : kind === 'memory'
        ? await buildMemory(
            env,
            [
              {
                articleId: 'article-1',
                title: fixture.title,
                summary,
                note: '',
                savedAt: '2026-11-07',
                project: fixture.title,
              },
            ],
            { name: fixture.title, description: '', scope: 'user' },
            undefined,
            fixture.language,
          )
        : await summarize(env, fixture.title, content, undefined, fixture.language);
  write('final.json', { success: true, calls: index, result });
} catch (error) {
  write('final.json', {
    success: false,
    calls: index,
    error: error instanceof Error ? error.message : String(error),
  });
}
