import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, Job } from './env';
import { isDemo } from './env';
import {
  articleMemoryStatements,
  memorySaveStatement,
  now,
  queueQuestionStatements,
  jobFailureStatements,
} from './db';
import { fetchArticle } from './ingest';
import { isYouTubeUrl, youtubeUnavailableMessage } from '../shared/youtube';
import {
  buildMemory,
  updateMemory,
  memoryText,
  modelName,
  summarize,
  generateQuestion,
  topicCounts,
  type AiCall,
} from './ai';
import {
  loadMemoryInputPage,
  memoryUpdateState,
  memorySourceStatements,
  type MemoryInput,
} from './memory';
import { dispatchJobs } from './jobs';
import type { ArticleSummary, MemoryData } from '../shared/domain';
import { runPufu } from './pufu';
import { aiStep, deferLimitedJob } from './usage';

const retry = {
  retries: { limit: 2, delay: '5 seconds' as const, backoff: 'exponential' as const },
  timeout: '3 minutes' as const,
};
async function claimJob(env: Env, id: string) {
  // 起動応答を失っても、開始済みのジョブはdispatcherの待機・失敗処理から保護する。
  // 停止が先に確定した場合は、遅れて起動したWorkflowをここで拒否する。
  return env.DB.prepare(
    "UPDATE processing_jobs SET status='running',updated_at=? WHERE id=? AND status NOT IN ('done','failed') RETURNING *",
  )
    .bind(now(), id)
    .first<Job>();
}
async function done(env: Env, id: string) {
  await env.DB.prepare(
    "UPDATE processing_jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now(), id)
    .run();
}
async function fail(env: Env, job: Job, message: string) {
  await env.DB.batch(jobFailureStatements(env, job, message));
}
async function runQuestion(env: Env, job: Job, step: WorkflowStep) {
  try {
    const source = await step.do('load-question-source', async () => {
      const row = await env.DB.prepare(
        "SELECT q.status, a.title, a.summary_json, s.note, p.name AS project_name, p.description FROM questions q JOIN stocks s ON s.id = q.stock_id JOIN projects p ON p.id = s.project_id JOIN articles a ON a.id = s.article_id WHERE q.stock_id = ? AND s.user_id = ? AND q.source = 'ai' AND q.generation = ? AND a.status = 'ready'",
      )
        .bind(job.target_id, job.user_id, job.revision)
        .first<{
          status: string;
          title: string;
          summary_json: string;
          note: string;
          project_name: string;
          description: string;
        }>();
      if (!row || row.status === 'ready') {
        await done(env, job.id);
        return null;
      }
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE questions SET status = 'generating', error = NULL, updated_at = ? WHERE stock_id = ? AND source = 'ai' AND generation = ? AND status != 'ready'",
        ).bind(now(), job.target_id, job.revision),
        env.DB.prepare(
          "UPDATE processing_jobs SET status = 'running', updated_at = ? WHERE id = ?",
        ).bind(now(), job.id),
      ]);
      return {
        title: row.title,
        summary: JSON.parse(row.summary_json) as ArticleSummary,
        note: row.note,
        project: { name: row.project_name, description: row.description },
      };
    });
    if (!source) return;
    const question = await aiStep(env, job, step, 'generate-question', () =>
      generateQuestion(env, source),
    );
    await step.do('save-question', async () => {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE questions SET text = ?, status = 'ready', error = NULL, model = ?, updated_at = ? WHERE stock_id = ? AND source = 'ai' AND generation = ? AND status != 'ready' AND EXISTS (SELECT 1 FROM stocks WHERE id = questions.stock_id AND user_id = ?)",
        ).bind(
          question.text,
          isDemo(env) && !env.AI ? 'local-question-template' : env.AI_MODEL,
          now(),
          job.target_id,
          job.revision,
          job.user_id,
        ),
        env.DB.prepare(
          "UPDATE processing_jobs SET status = 'done', updated_at = ? WHERE id = ?",
        ).bind(now(), job.id),
      ]);
    });
  } catch (error) {
    if (await deferLimitedJob(env, job, error)) return;
    await step.do('record-question-failure', () =>
      fail(env, job, '問い・気づきを生成できませんでした。「再試行」からやり直せます。'),
    );
    throw error;
  }
}
export class ArticleWorkflow extends WorkflowEntrypoint<Env, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const job = await step.do('load-job', () => claimJob(this.env, event.payload.jobId));
    if (!job || job.status === 'done') return;
    if (job.kind === 'pufu') return runPufu(this.env, job, step);
    if (job.kind === 'question') return runQuestion(this.env, job, step);
    if (job.kind === 'cleanup') {
      await step.do('delete-orphan-body', retry, async () => {
        const referenced = await this.env.DB.prepare(
          'SELECT id FROM articles WHERE content_key = ?',
        )
          .bind(job.target_id)
          .first();
        if (!referenced) await this.env.CONTENT.delete(job.target_id);
      });
      await step.do('finish-cleanup', () => done(this.env, job.id));
      return;
    }
    try {
      const article = await step.do('load-article', async () => {
        const row = await this.env.DB.prepare(
          'SELECT id, source_url, source_type, input_text, title, status FROM articles WHERE id = ? AND user_id = ? AND generation = ?',
        )
          .bind(job.target_id, job.user_id, job.revision)
          .first<{
            id: string;
            source_url: string;
            source_type: 'url' | 'text';
            input_text: string | null;
            title: string;
            status: string;
          }>();
        if (!row || row.status === 'ready') {
          await done(this.env, job.id);
          return null;
        }
        await this.env.DB.batch([
          this.env.DB.prepare(
            "UPDATE articles SET status = 'extracting', updated_at = ? WHERE id = ? AND generation = ?",
          ).bind(now(), row.id, job.revision),
          this.env.DB.prepare(
            "UPDATE processing_jobs SET status = 'running', updated_at = ? WHERE id = ?",
          ).bind(now(), job.id),
        ]);
        return row;
      });
      if (!article) return;
      if (article.source_type === 'url' && isYouTubeUrl(article.source_url))
        throw new Error(youtubeUnavailableMessage);
      const key = `${job.user_id}/${article.id}/${job.revision}.txt`;
      const title = await step.do('fetch-and-store-content', retry, async () => {
        const current = await this.env.DB.prepare(
          'SELECT id, content_key FROM articles WHERE id = ? AND generation = ?',
        )
          .bind(article.id, job.revision)
          .first<{ id: string; content_key: string | null }>();
        if (!current) return null;
        if (article.source_type === 'text' && !article.input_text)
          throw new Error('保存したテキスト本文が見つかりません。');
        const content = article.input_text
          ? { title: article.title, text: article.input_text }
          : await fetchArticle(this.env, article.source_url, job.user_id);
        await this.env.CONTENT.put(key, content.text, {
          httpMetadata: { contentType: 'text/plain; charset=utf-8' },
        });
        const statements = [
          this.env.DB.prepare(
            "UPDATE articles SET title = ?, content_key = ?, status = 'summarizing', updated_at = ? WHERE id = ? AND generation = ?",
          ).bind(content.title, key, now(), article.id, job.revision),
        ];
        if (current.content_key && current.content_key !== key) {
          statements.push(
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT ?, ?, 'cleanup', ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND generation = ? AND content_key = ?)",
            ).bind(
              `gc-old-${article.id}-${job.revision}`,
              job.user_id,
              current.content_key,
              job.revision,
              article.id,
              job.revision,
              key,
            ),
          );
        }
        const result = await this.env.DB.batch(statements);
        if (!result[0].meta.changes) {
          await this.env.CONTENT.delete(key);
          return null;
        }
        return content.title;
      });
      if (!title) {
        await step.do('finish-deleted-article', () => done(this.env, job.id));
        return;
      }
      const text = await step.do('read-article-body', async () => {
        const content = await this.env.CONTENT.get(key);
        if (!content) throw new Error('保存した本文が見つかりません。');
        return content.text();
      });
      const summary = await summarize(this.env, title, text, (name, operation) =>
        aiStep(this.env, job, step, name, operation),
      );
      await step.do('commit-summary', async () => {
        const current = await this.env.DB.prepare(
          'SELECT status FROM articles WHERE id = ? AND generation = ?',
        )
          .bind(article.id, job.revision)
          .first<{ status: string }>();
        if (!current || current.status === 'ready') {
          await done(this.env, job.id);
          return;
        }
        await this.env.DB.batch([
          this.env.DB.prepare(
            "UPDATE articles SET summary_json = ?, model = ?, status = 'ready', error = NULL, updated_at = ? WHERE id = ? AND generation = ?",
          ).bind(
            JSON.stringify(summary),
            summary.shortSource ? 'source-extract' : modelName(this.env),
            now(),
            article.id,
            job.revision,
          ),
          ...articleMemoryStatements(this.env, job.user_id, article.id),
          ...queueQuestionStatements(this.env, null, article.id),
          this.env.DB.prepare(
            "UPDATE processing_jobs SET status = 'done', updated_at = ? WHERE id = ?",
          ).bind(now(), job.id),
        ]);
      });
      await step.do('dispatch-memory-updates', () => dispatchJobs(this.env));
    } catch (error) {
      if (await deferLimitedJob(this.env, job, error)) return;
      const message =
        error instanceof Error
          ? error.message.slice(0, 400)
          : '記事の処理に失敗しました。再試行してください。';
      await step.do('record-failure', () => fail(this.env, job, message));
      await step.do('dispatch-cleanup-after-failure', () => dispatchJobs(this.env));
      throw error;
    }
  }
}
export class MemoryWorkflow extends WorkflowEntrypoint<Env, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const job = await step.do('load-job', () => claimJob(this.env, event.payload.jobId));
    if (!job || job.status === 'done') return;
    if (!isDemo(this.env)) await step.sleep('coalesce-saves', '30 seconds');
    try {
      const project = job.kind === 'project_memory';
      // 古いWorkflowのステップが再開されても、移行前の本人情報を再利用しない。
      if (!project) {
        const current = await this.env.DB.prepare(
          'SELECT memory_revision FROM users WHERE id=? AND onboarding_completed_at IS NOT NULL',
        )
          .bind(job.user_id)
          .first<{ memory_revision: number }>();
        if (!current || current.memory_revision !== job.revision) {
          await done(this.env, job.id);
          return;
        }
      }
      const owner = await step.do('load-current-revision', async () => {
        const row = project
          ? await this.env.DB.prepare(
              'SELECT memory_revision, name, description FROM projects WHERE id = ? AND user_id = ?',
            )
              .bind(job.target_id, job.user_id)
              .first<{ memory_revision: number; name: string; description: string }>()
          : await this.env.DB.prepare(
              'SELECT memory_revision, name, bio AS description FROM users WHERE id = ?',
            )
              .bind(job.user_id)
              .first<{ memory_revision: number; name: string; description: string }>();
        if (!row || row.memory_revision !== job.revision) {
          await done(this.env, job.id);
          return null;
        }
        await this.env.DB.prepare(
          "UPDATE processing_jobs SET status = 'running', error = NULL, updated_at = ? WHERE id = ?",
        )
          .bind(now(), job.id)
          .run();
        return row;
      });
      if (!owner) return;
      const inputs: MemoryInput[] = [];
      for (let page = 0; ; page++) {
        const rows = await step.do(`memory-input-page-${page}`, () =>
          loadMemoryInputPage(this.env, job.user_id, project ? job.target_id : null, page),
        );
        inputs.push(...rows.inputs);
        if (!rows.hasMore) break;
      }
      const context = {
        name: project ? owner.name : '',
        description: owner.description,
        scope: project ? 'project' : 'user',
      };
      const state = await step.do('load-memory-input-state', () =>
        memoryUpdateState(this.env, job.user_id, project ? job.target_id : null, context, inputs),
      );
      const full = job.memory_mode === 'full' || !state.current || Boolean(state.fullReason);
      if (!full && !state.addedIds.length) {
        await step.do('finish-unchanged-memory', () => done(this.env, job.id));
        return;
      }
      const call: AiCall<MemoryData> = (name, operation) =>
        aiStep(this.env, job, step, name, operation);
      // ステップに永続化するのはIDだけ。要約をまとめた戻り値の1MiB超過を防ぐ。
      const addedIds = new Set(state.addedIds);
      const memory = full
        ? await buildMemory(
            this.env,
            inputs.map((input) => input.source),
            context,
            call,
          )
        : await updateMemory(
            this.env,
            state.current!,
            inputs
              .filter((input) => addedIds.has(input.source.articleId))
              .map((input) => input.source),
            context,
            {
              articleCount: inputs.length,
              topicCounts: topicCounts(inputs.map((input) => input.source)).slice(0, 30),
            },
            call,
          );
      await step.do('save-if-revision-current', async () => {
        await this.env.DB.batch([
          memorySaveStatement(this.env, {
            userId: job.user_id,
            projectId: project ? job.target_id : null,
            revision: job.revision,
            text: memoryText(memory),
            dataJson: JSON.stringify(memory),
            articleCount: inputs.length,
            model: modelName(this.env),
            contextHash: state.contextHash,
          }),
          ...memorySourceStatements(this.env, state.id, job.revision, inputs),
          this.env.DB.prepare(
            "UPDATE processing_jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?",
          ).bind(now(), job.id),
        ]);
      });
    } catch (error) {
      if (await deferLimitedJob(this.env, job, error)) return;
      await step.do('record-failure', () =>
        fail(this.env, job, 'メモリを更新できませんでした。「再生成」から再試行できます。'),
      );
      throw error;
    }
  }
}
