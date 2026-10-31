import type { Principal } from './env';
import { HTTPException } from 'hono/http-exception';

// null means all projects; an empty list must never mean unrestricted access.
export function allowedProjectIds(principal: Principal): string[] | null {
  return principal.tokenProjectIds !== undefined
    ? principal.tokenProjectIds
    : principal.tokenProjectId
      ? [principal.tokenProjectId]
      : null;
}
export function projectScopeJson(principal: Principal): string | null {
  const ids = allowedProjectIds(principal);
  return ids === null ? null : JSON.stringify(ids);
}
export function canAccessProject(principal: Principal, id: string): boolean {
  const ids = allowedProjectIds(principal);
  return ids === null || ids.includes(id);
}
export function resolveProjectId(principal: Principal, requested: string | null): string | null {
  if (requested && !canAccessProject(principal, requested)) throw new HTTPException(403);
  const ids = allowedProjectIds(principal);
  return requested ?? (ids?.length === 1 ? ids[0] : null);
}
// Every listing applies this before pagination, totals, and semantic candidates.
// Explicitly authorized projects remain visible even if hidden from all-project lists.
export function projectListFilter(projectId: string | null, projectIds: string[] | null = null) {
  const scope = projectIds === null ? null : JSON.stringify(projectIds);
  return {
    sql: '(? IS NULL OR p.id=?) AND (? IS NULL OR p.id IN (SELECT value FROM json_each(?))) AND (? IS NOT NULL OR ? IS NOT NULL OR p.show_in_all_lists=1)',
    params: [projectId, projectId, scope, scope, projectId, scope],
  };
}
