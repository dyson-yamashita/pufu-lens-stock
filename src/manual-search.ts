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
// Non-leaf titles can be abstract. Give every direct child a share of the existing
// preview budget so early paragraphs cannot hide later topics from the decision model.
function branchPreview(node: ManualNode) {
  if (!node.children.length) return node.text.slice(0, 240);
  const share = Math.floor((240 - node.children.length + 1) / node.children.length);
  return node.children.map((child) => (child.title || child.text).slice(0, share)).join('\n');
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
          preview: branchPreview(node),
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
