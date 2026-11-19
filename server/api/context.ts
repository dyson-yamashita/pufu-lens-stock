import { HTTPException } from 'hono/http-exception';
import { type QuestionDetail } from '../../shared/domain';
import { type PufuSummary } from '../../shared/pufu';
import type { AppEnv, Env } from '../env';
import { canAccessProject, projectScopeJson } from '../features/projects/project-access';
import { withRelations } from '../features/relations/relations';
import { pufuColumns, questionColumns, questionJoins } from './queries';

export async function ownedProject(env: Env, userId: string, id: string) {
  const project = await env.DB.prepare(
    'SELECT id, name, description, memory_revision, include_in_user_memory FROM projects WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first<{
      id: string;
      name: string;
      description: string;
      memory_revision: number;
      include_in_user_memory: number;
    }>();
  if (!project) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
  return project;
}

export async function ownedStock(c: import('hono').Context<AppEnv>) {
  const stock = await c.env.DB.prepare(
    'SELECT s.id, s.project_id, s.article_id, s.note, a.title AS article_title, a.source_type, a.source_url, a.status, a.generation, a.has_og_image, a.content_key, a.input_text, a.skip_summary FROM stocks s JOIN articles a ON a.id = s.article_id WHERE s.id = ? AND s.user_id = ?',
  )
    .bind(c.req.param('id'), c.get('principal').user.id)
    .first<{
      id: string;
      project_id: string;
      article_id: string;
      note: string;
      article_title: string;
      source_type: 'url' | 'text';
      source_url: string;
      status: string;
      generation: number;
      has_og_image: number;
      content_key: string | null;
      input_text: string | null;
      skip_summary: number;
    }>();
  if (!stock || !canAccessProject(c.get('principal'), stock.project_id))
    throw new HTTPException(404, { message: '記事が見つかりません。' });
  return stock;
}

export async function ownedQuestion(c: import('hono').Context<AppEnv>) {
  const question = await c.env.DB.prepare(
    `SELECT ${questionColumns}, q.note FROM ${questionJoins} WHERE q.id = ? AND p.user_id = ?`,
  )
    .bind(c.req.param('id'), c.get('principal').user.id)
    .first<QuestionDetail>();
  if (!question || !canAccessProject(c.get('principal'), question.project_id))
    throw new HTTPException(404, { message: '問い・気づきが見つかりません。' });
  return withRelations(question);
}

export async function ownedPufu(c: import('hono').Context<AppEnv>) {
  const pufu = await c.env.DB.prepare(
    `SELECT ${pufuColumns} FROM pufu_scores WHERE id = ? AND user_id = ? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?)))`,
  )
    .bind(
      c.req.param('id'),
      c.get('principal').user.id,
      projectScopeJson(c.get('principal')),
      projectScopeJson(c.get('principal')),
    )
    .first<PufuSummary>();
  if (!pufu) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
  return pufu;
}
