import { z } from 'zod';
import { type MemoryCoverage } from '../../../shared/domain';
import type { McpToolContext } from '../tool-context';
import { id, read } from '../tool-schemas';
export function registerMemoryTools(context: McpToolContext) {
  const { t, register, invoke, run, security, query } = context;
  register(
    'get_project_memory',
    {
      title: 'プロジェクトメモリ取得',
      description: t('mcp.memory.description'),
      inputSchema: z.object({
        project_id: id.describe(t('mcp.memory.project_id')),
        revision: z.number().int().min(0).optional().describe(t('mcp.memory.revision')),
      }),
      annotations: read,
      _meta: security('memories:read'),
    },
    (args) =>
      run('memories:read', async () => {
        if (args.revision !== undefined)
          return invoke(
            `memory/history/${args.revision}?${query({ project_id: args.project_id })}`,
          );
        const data = await invoke(`memory?${query(args)}`);
        const coverage = data.coverage as MemoryCoverage;
        return {
          ...data,
          coverage: {
            ...coverage,
            full_rebuild_reason: coverage.full_rebuild_reason
              ? t(coverage.full_rebuild_reason)
              : null,
          },
        };
      }),
  );

  register(
    'list_project_memory_versions',
    {
      title: 'プロジェクトメモリ履歴',
      description: t('mcp.memory.history_description'),
      inputSchema: z.object({
        project_id: id.describe(t('mcp.memory.project_id')),
        before: z.number().int().min(0).optional(),
      }),
      annotations: read,
      _meta: security('memories:read'),
    },
    (args) => run('memories:read', () => invoke(`memory/history?${query(args)}`)),
  );
}
