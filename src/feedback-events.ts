import type { FeedbackAction } from '../shared/feedback';

type Outcome = 'success' | 'validation' | 'operation' | 'network' | 'ignore';
export type FeedbackEvent =
  | { type: 'start'; id: number; key: string; busy: boolean }
  | { type: 'end'; id: number; outcome: Outcome }
  | { type: 'local'; action: FeedbackAction; key: string; outcome: Outcome };
const listeners = new Set<(event: FeedbackEvent) => void>();
let sequence = 0;
const emit = (event: FeedbackEvent) => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* Detection never interrupts a user operation. */
    }
  }
};
export function subscribeFeedback(listener: (event: FeedbackEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function reportFeedback(action: FeedbackAction, outcome: Outcome, key: string = action) {
  emit({ type: 'local', action, outcome, key });
}
// Never retain request URLs, IDs, query strings, bodies, or error messages.
export function feedbackRequestKey(path: string, method: string) {
  if (!path.startsWith('/api/v1/')) return null;
  const segments = path.slice(8).split('?')[0].split('/');
  if (
    ['feedback', 'config', 'onboarding'].includes(segments[0]) ||
    (segments[0] === 'me' && method === 'GET')
  )
    return null;
  const allowed = new Set([
    'me',
    'stocks',
    'articles',
    'questions',
    'pufus',
    'projects',
    'comments',
    'memory',
    'memories',
    'tokens',
    'connections',
    'mcp',
    'images',
    'title',
    'favorite',
    'phases',
    'retry',
    'notes',
    'rebuild',
    'versions',
    'publication',
    'settings',
  ]);
  return `${['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? method : 'OTHER'}:${segments.map((s) => (allowed.has(s) ? s : ':id')).join('/')}`;
}
export function beginFeedbackRequest(path: string, method: string) {
  const key = feedbackRequestKey(path, method);
  if (!key) return (_outcome: Outcome) => {};
  const id = ++sequence;
  let finished = false;
  emit({ type: 'start', id, key, busy: method !== 'GET' });
  return (outcome: Outcome) => {
    if (!finished) {
      finished = true;
      emit({ type: 'end', id, outcome });
    }
  };
}
