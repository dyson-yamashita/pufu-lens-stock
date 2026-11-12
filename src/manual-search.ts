import type { Language } from '../shared/locale';
import { api, createRequestId } from './api';
export type ManualNode = {
  id: string;
  title: string;
  text: string;
  href: string;
  children: ManualNode[];
};
export async function manualTree(language: Language): Promise<ManualNode[]> {
  const { getManualTree } = await import('./UserManual');
  return getManualTree(language);
}
export async function selectManualBranch(
  owner: string,
  question: string,
  nodes: ManualNode[],
  language: Language,
  signal: AbortSignal,
) {
  const result = await api<{ selection: number | null; available: boolean }>(
    '/api/v1/feedback/manual-search',
    {
      method: 'POST',
      signal,
      body: JSON.stringify({
        request_id: createRequestId(),
        owner_id: owner,
        question,
        language,
        choices: nodes.map((node) => ({
          title: node.title.slice(0, 160),
          preview: node.text.slice(0, 240),
        })),
      }),
    },
  );
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return result.selection !== null &&
    Number.isInteger(result.selection) &&
    result.selection >= 0 &&
    result.selection < nodes.length
    ? nodes[result.selection]
    : null;
}
