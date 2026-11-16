import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { resolveLanguage } from '../../../shared/locale';
import type { AppEnv } from '../../env';
import { memoryCoverage, memoryId } from '../../features/memory/memory';
import { listMemoryVersions, readMemoryVersion } from '../../features/memory/memory-history';
import { resolveProjectId } from '../../features/projects/project-access';
import { assertOperation, reserveOperation } from '../../features/usage/usage';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject } from '../context';
import { body } from '../validation';

export function registerMemoryRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/memory/history', async (c) => {
    const principal = c.get('principal');
    const requested = c.req.query('project_id') || null;
    if (principal.kind === 'mcp' && !requested)
      throw new HTTPException(400, { message: '取得するプロジェクトを指定してください。' });
    const projectId = principal.kind === 'mcp' ? resolveProjectId(principal, requested) : requested;
    if (projectId) await ownedProject(c.env, principal.user.id, projectId);
    const parsed = z.coerce.number().int().min(0).safeParse(c.req.query('before'));
    if (c.req.query('before') !== undefined && !parsed.success)
      throw new HTTPException(400, { message: '履歴の版番号を正しく指定してください。' });
    return c.json(
      await listMemoryVersions(
        c.env,
        principal.user.id,
        projectId,
        c.req.query('before') === undefined ? undefined : parsed.data,
      ),
    );
  });

  app.get('/api/v1/memory/history/:revision', async (c) => {
    const principal = c.get('principal');
    const requested = c.req.query('project_id') || null;
    if (principal.kind === 'mcp' && !requested)
      throw new HTTPException(400, { message: '取得するプロジェクトを指定してください。' });
    const projectId = principal.kind === 'mcp' ? resolveProjectId(principal, requested) : requested;
    if (projectId) await ownedProject(c.env, principal.user.id, projectId);
    const parsed = z.coerce.number().int().min(0).safeParse(c.req.param('revision'));
    if (!parsed.success)
      throw new HTTPException(400, { message: '履歴の版番号を正しく指定してください。' });
    const version = await readMemoryVersion(c.env, principal.user.id, projectId, parsed.data);
    if (!version) throw new HTTPException(404, { message: 'メモリ履歴が見つかりません。' });
    return c.json({ version });
  });

  app.get('/api/v1/memory', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const requestedProjectId = c.req.query('project_id') || null;
    if (principal.kind === 'mcp' && !requestedProjectId)
      throw new HTTPException(400, { message: '取得するプロジェクトを指定してください。' });
    const projectId =
      principal.kind === 'mcp'
        ? resolveProjectId(principal, requestedProjectId)
        : requestedProjectId;
    const owner = projectId
      ? await ownedProject(c.env, user.id, projectId)
      : await c.env.DB.prepare(
          'SELECT memory_revision,name,bio AS description FROM users WHERE id = ?',
        )
          .bind(user.id)
          .first<{ memory_revision: number; name: string; description: string }>();
    const coverage = await memoryCoverage(
      c.env,
      user.id,
      projectId,
      {
        name: owner!.name,
        description: owner!.description,
        scope: projectId ? 'project' : 'user',
      },
      resolveLanguage(user.language),
    );
    const memoryId = projectId ? `project-${projectId}` : `user-${user.id}`;
    const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?')
      .bind(memoryId, user.id)
      .first();
    const job = await c.env.DB.prepare(
      "SELECT status, error FROM processing_jobs WHERE user_id = ? AND kind = ? AND target_id = ? AND revision = ? ORDER BY status IN ('pending','dispatched','running') DESC, created_at DESC LIMIT 1",
    )
      .bind(
        user.id,
        projectId ? 'project_memory' : 'user_memory',
        projectId ?? user.id,
        owner!.memory_revision,
      )
      .first<{ status: string; error: string | null }>();
    const pending = Boolean(job && ['pending', 'dispatched', 'running'].includes(job.status));
    if (!row) return c.json({ memory: null, pending, error: job?.error ?? null, coverage });
    const { data_json, ...memory } = row;
    return c.json({
      memory: {
        ...memory,
        data: JSON.parse(String(data_json)),
        current_revision: owner!.memory_revision,
        pending,
        error: job?.error ?? null,
      },
      pending,
      error: job?.error ?? null,
      coverage,
    });
  });

  app.post('/api/v1/memory/rebuild', async (c) => {
    const { user } = c.get('principal');
    const data = await body(
      c,
      z.object({
        project_id: z.string().max(100).nullable().default(null),
        request_id: z.uuid().optional(),
        mode: z.enum(['incremental', 'full']).default('full'),
      }),
    );
    if (data.project_id) await ownedProject(c.env, user.id, data.project_id);
    const key = c.req.header('Idempotency-Key') ?? data.request_id ?? crypto.randomUUID();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
      throw new HTTPException(400, { message: 'リクエストIDの形式が正しくありません。' });
    const requestId = `memory-${user.id}-${key}`;
    const previous = await c.env.DB.prepare(
      'SELECT project_id,mode FROM memory_requests WHERE id=? AND user_id=?',
    )
      .bind(requestId, user.id)
      .first<{ project_id: string | null; mode: string }>();
    if (previous) {
      if (previous.project_id !== data.project_id || previous.mode !== data.mode)
        throw new HTTPException(409, {
          message: '同じリクエストIDで異なる保存先または更新方法が送信されました。',
        });
      return c.json({ ok: true }, 202);
    }
    const target = data.project_id
      ? { id: data.project_id, kind: 'project_memory' as const, table: 'projects' }
      : { id: user.id, kind: 'user_memory' as const, table: 'users' };
    const id = `${requestId}-${target.kind}`;
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        'INSERT INTO memory_requests (id,user_id,project_id,mode) VALUES (?,?,?,?)',
      ).bind(requestId, user.id, data.project_id, data.mode),
      reserveOperation(c.env, { id, user_id: user.id, kind: target.kind }),
      assertOperation(c.env, id),
      c.env.DB.prepare(
        `UPDATE ${target.table} SET memory_revision=memory_revision+1 WHERE id=?`,
      ).bind(target.id),
      c.env.DB.prepare(
        `INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,memory_mode) SELECT ?,?,?,id,memory_revision,? FROM ${target.table} WHERE id=?`,
      ).bind(id, user.id, target.kind, data.mode, target.id),
    ];
    if (data.mode === 'full')
      statements.push(
        c.env.DB.prepare('UPDATE memories SET force_full=1 WHERE id=? AND user_id=?').bind(
          memoryId(user.id, data.project_id),
          user.id,
        ),
      );
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const replay = await c.env.DB.prepare(
        'SELECT project_id,mode FROM memory_requests WHERE id=? AND user_id=?',
      )
        .bind(requestId, user.id)
        .first<{ project_id: string | null; mode: string }>();
      if (!replay) throw error;
      if (replay.project_id !== data.project_id || replay.mode !== data.mode)
        throw new HTTPException(409, {
          message: '同じリクエストIDで異なる保存先または更新方法が送信されました。',
        });
    }
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });
}
