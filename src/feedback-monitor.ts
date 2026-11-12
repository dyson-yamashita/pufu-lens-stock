import { feedbackActions, type FeedbackAction } from '../shared/feedback';
import { FeedbackDetector } from './feedback-detector';
import { subscribeFeedback } from './feedback-events';

export function monitorFeedback(
  detector: FeedbackDetector,
  onHost: (host: HTMLElement | null) => void,
  onBlocked: (blocked: boolean) => void,
) {
  const ids = new WeakMap<Element, string>();
  let nextId = 0,
    interaction = 0;
  let apiErrorInteraction = -1;
  const id = (node: Element) => {
    let value = ids.get(node);
    if (!value) {
      value = `control-${++nextId}`;
      ids.set(node, value);
    }
    return value;
  };
  const own = (node: Element | null) => !!node?.closest('.pufi-feedback');
  const validations = new Map<string, number>();
  const seenAlerts = new WeakSet<Element>();
  type Control = { node: Element; key: string; action: FeedbackAction; time: number };
  let clicked: Control | null = null;
  let pending: Control | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, 0);
    timers.add(timer);
  };
  const related = (control: Control | null) => {
    if (!control) return [];
    const scope = control.node.closest('form,dialog') ?? control.node;
    return [
      control.key,
      id(scope),
      ...[...scope.querySelectorAll('input,select,textarea')].map(id),
      ...(['save', 'import', 'download'].includes(control.action) ? [control.action] : []),
    ];
  };
  const requests = new Map<
    number,
    { key: string; action: FeedbackAction; busy: boolean; related: string[] }
  >();
  const sync = () => {
    const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open]')];
    const focused = document.activeElement?.closest<HTMLElement>('dialog[open]');
    onHost(focused ?? dialogs.at(-1) ?? null);
    onBlocked(
      [...requests.values()].some((r) => r.busy) ||
        !!document.querySelector(
          '[aria-busy="true"], .onboarding-page, dialog[open] .pufu-download-options',
        ),
    );
  };
  const validation = (node: Element) => {
    if (apiErrorInteraction === interaction) return;
    const scope = node.closest('form') ?? node.parentElement ?? node;
    const key = id(scope);
    if (validations.get(key) === interaction) return;
    validations.set(key, interaction);
    while (validations.size > 200) validations.delete(validations.keys().next().value!);
    detector.validation('input', key);
  };
  const click = (event: Event) => {
    const target = event.target as Element | null;
    const node = target?.closest?.('button,a[href],[role="button"],summary');
    if (!node || own(node) || node.matches(':disabled,[aria-disabled="true"]')) return;
    interaction++;
    const value = (node as HTMLElement).dataset.feedbackAction;
    const action =
      value && feedbackActions.includes(value as FeedbackAction)
        ? (value as FeedbackAction)
        : 'control';
    clicked = { node, key: id(node), action, time: Date.now() };
    pending = clicked;
    detector.click(action, clicked.key);
    // Native links, disclosure controls, and form validation are normal reactions.
    if (node.matches('a[href],summary')) detector.acknowledge(action, clicked.key);
    later(() => {
      pending = null;
    });
  };
  const invalid = (event: Event) => {
    const node = event.target as Element | null;
    if (!node || own(node)) return;
    if (clicked) detector.acknowledge(clicked.action, clicked.key);
    const key = id(node);
    if (validations.get(key) === interaction) return;
    validations.set(key, interaction);
    detector.validation('input', key);
  };
  const submit = (event: Event) => {
    const form = event.target as HTMLFormElement | null;
    if (!form || own(form)) return;
    later(() => {
      if (form.querySelector('[role="alert"]')) validation(form);
    });
  };
  const observer = new window.MutationObserver((records) => {
    const external = records.some(
      (r) => !own(r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement),
    );
    if (external && pending) detector.acknowledge(pending.action, pending.key);
    for (const alert of document.querySelectorAll('[role="alert"]')) {
      if (own(alert) || seenAlerts.has(alert) || !alert.hasChildNodes()) continue;
      seenAlerts.add(alert);
      validation(alert);
    }
    sync();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const unsubscribe = subscribeFeedback((event) => {
    if (event.type === 'start') {
      if (clicked && Date.now() - clicked.time > 1000) clicked = null;
      if (clicked) detector.acknowledge(clicked.action, clicked.key);
      requests.set(event.id, {
        key: event.key,
        action: clicked?.action ?? 'request',
        busy: event.busy,
        related: event.busy ? related(clicked) : [],
      });
      sync();
      return;
    }
    let action: FeedbackAction, key: string, outcome: string;
    let cleared: string[] = [];
    if (event.type === 'end') {
      const request = requests.get(event.id);
      if (!request) return;
      requests.delete(event.id);
      ({ action, key } = request);
      cleared = request.related;
      outcome = event.outcome;
      if (outcome !== 'success' && outcome !== 'ignore') apiErrorInteraction = interaction;
    } else {
      ({ action, key, outcome } = event);
      cleared =
        clicked && Date.now() - clicked.time <= 1000 && clicked.action === action
          ? related(clicked)
          : [];
    }
    if (outcome === 'success') {
      for (const relatedKey of [key, ...cleared]) {
        detector.progress(action, relatedKey);
        validations.delete(relatedKey);
      }
    } else if (outcome === 'validation') detector.validation(action, key);
    else if (outcome === 'operation' || outcome === 'network')
      detector.failure(action, outcome, key);
    sync();
  });
  detector.enable(true);
  sync();
  document.addEventListener('click', click, true);
  document.addEventListener('invalid', invalid, true);
  document.addEventListener('submit', submit, true);
  return () => {
    unsubscribe();
    observer.disconnect();
    for (const timer of timers) clearTimeout(timer);
    document.removeEventListener('click', click, true);
    document.removeEventListener('invalid', invalid, true);
    document.removeEventListener('submit', submit, true);
    detector.enable(false);
  };
}
