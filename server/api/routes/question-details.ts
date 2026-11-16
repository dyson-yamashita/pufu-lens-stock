import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { questionSettingsSchema } from '../../../shared/domain';
import { type PufuSummary } from '../../../shared/pufu';
import type { AppEnv } from '../../env';
import { generateQuestionPufuImage } from '../../features/pufu/images/pufu-images';
import { readQuestionPufu } from '../../features/pufu/pufu-read';
import { firstPhaseTaskColumn } from '../../features/pufu/pufu-title';
import { replaceRelations, validateRelations } from '../../features/relations/relations';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject, ownedQuestion } from '../context';
import { pufuColumns } from '../queries';
import { body } from '../validation';

export function registerQuestionDetailsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/questions/:id', async (c) => {
    const question = await ownedQuestion(c);
    const pufus = await c.env.DB.prepare(
      `SELECT ${pufuColumns},${firstPhaseTaskColumn('pufu_scores')} FROM pufu_scores WHERE EXISTS (SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pufu_scores.id AND pq.question_id=?) AND user_id = ? AND project_id=? ORDER BY created_at DESC,id DESC`,
    )
      .bind(question.id, c.get('principal').user.id, question.project_id)
      .all<PufuSummary>();
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ question, pufus: pufus.results });
  });

  app.patch('/api/v1/questions/:id', async (c) => {
    const data = await body(c, questionSettingsSchema);
    const question = await ownedQuestion(c);
    const { user } = c.get('principal');
    const projectId = data.project_id ?? question.project_id;
    await ownedProject(c.env, user.id, projectId);
    if (question.stock_id && projectId !== question.project_id)
      throw new HTTPException(409, {
        message: '記事に紐づく問い・気づきの保存先は、元の記事で変更してください。',
      });
    if (data.stock_ids !== undefined) await validateRelations(c.env, projectId, [], data.stock_ids);
    if (projectId !== question.project_id && question.stocks?.length)
      throw new HTTPException(409, {
        message: '保存先を変更する前に、ストックの関連を解除してください。',
      });
    const condition =
      'SELECT 1 FROM questions q JOIN projects p ON p.id=q.project_id WHERE q.id=? AND q.project_id=? AND p.user_id=? AND q.stock_id IS ?';
    const results = await c.env.DB.batch([
      ...replaceRelations(
        c.env,
        'question',
        question.id,
        { stock_ids: data.stock_ids },
        condition,
        [question.id, question.project_id, user.id, question.stock_id],
      ),
      c.env.DB.prepare(
        `UPDATE questions SET stock_id=CASE WHEN source='user' AND ?=1 THEN ? ELSE stock_id END, note = COALESCE(?, note), project_id = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND stock_id IS ?
       AND EXISTS (SELECT 1 FROM projects WHERE id = questions.project_id AND user_id = ?)
       AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?) RETURNING id`,
      ).bind(
        data.stock_ids !== undefined ? 1 : 0,
        data.stock_ids?.[0] ?? null,
        data.note ?? null,
        projectId,
        now(),
        question.id,
        question.project_id,
        question.stock_id,
        user.id,
        projectId,
        user.id,
      ),
    ]);
    if (!results.at(-1)!.results[0])
      throw new HTTPException(409, {
        message: '問い・気づきの保存先が変更されました。再読み込みしてお試しください。',
      });
    return c.json({ question: await ownedQuestion(c) });
  });

  app.get('/api/v1/questions/:id/pufu', async (c) =>
    c.json(await readQuestionPufu(c.env, c.get('principal'), c.req.param('id'))),
  );

  app.get('/api/v1/questions/:id/pufu/image', async (c) => {
    const image = await generateQuestionPufuImage(c.env, c.get('principal'), c.req.param('id'));
    if (!image.png) return c.json(image.metadata);
    return c.body(new Uint8Array(image.png), 200, { 'Content-Type': 'image/png' });
  });

  app.get('/api/v1/questions/:question_id/pufu/:pufu_id', async (c) =>
    c.json(
      await readQuestionPufu(
        c.env,
        c.get('principal'),
        c.req.param('question_id'),
        c.req.param('pufu_id'),
      ),
    ),
  );

  app.get('/api/v1/questions/:question_id/pufu/:pufu_id/image', async (c) => {
    const image = await generateQuestionPufuImage(
      c.env,
      c.get('principal'),
      c.req.param('question_id'),
      c.req.param('pufu_id'),
    );
    return c.body(new Uint8Array(image.png!), 200, { 'Content-Type': 'image/png' });
  });

  app.delete('/api/v1/questions/:id', async (c) => {
    const question = await ownedQuestion(c);
    const { user } = c.get('principal');
    const statements: D1PreparedStatement[] = [];
    if (question.source === 'ai') {
      statements.push(
        c.env.DB.prepare(
          'UPDATE stocks SET ai_question_dismissed = 1 WHERE id = ? AND user_id = ?',
        ).bind(question.stock_id, user.id),
        c.env.DB.prepare(
          "UPDATE processing_jobs SET status = 'done', error = NULL, updated_at = ? WHERE user_id = ? AND kind = 'question' AND target_id = ? AND status != 'done'",
        ).bind(now(), user.id, question.stock_id),
      );
    }
    statements.push(
      c.env.DB.prepare(
        'DELETE FROM questions WHERE id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = questions.project_id AND user_id = ?)',
      ).bind(question.id, user.id),
    );
    await c.env.DB.batch(statements);
    return c.json({ ok: true });
  });
}
