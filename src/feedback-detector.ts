import type { FeedbackAction, FeedbackReason, FeedbackInput } from '../shared/feedback';

type FailureReason = 'validation_repeat' | 'operation_repeat' | 'network_repeat';
type ScoredSignal = { type: FeedbackReason; action: FeedbackAction; time: number; score: number };
const scores: Record<FeedbackReason, number> = {
  rage_click: 3,
  navigation_loop: 2,
  validation_repeat: 2,
  operation_repeat: 3,
  network_repeat: 3,
};
// All state stays in memory. Values, error messages and DOM text are never retained.
export class FeedbackDetector {
  private enabled = false;
  private clicks = new Map<FeedbackAction, number[]>();
  private failures = new Map<
    string,
    { type: FailureReason; action: FeedbackAction; times: number[] }
  >();
  private routes: { screen: string; time: number }[] = [];
  private signals = new Map<string, ScoredSignal>();
  constructor(private clock = Date.now) {}
  enable(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  reset() {
    this.clicks.clear();
    this.failures.clear();
    this.routes = [];
    this.signals.clear();
  }
  click(action: FeedbackAction) {
    if (!this.enabled) return;
    const time = this.clock();
    this.clicks.set(
      action,
      [...(this.clicks.get(action) ?? []).filter((t) => time - t < 8000), time].slice(-4),
    );
  }
  acknowledge(action: FeedbackAction) {
    this.clicks.delete(action);
    this.signals.delete(`rage_click:${action}`);
  }
  progress(action: FeedbackAction) {
    this.clicks.delete(action);
    for (const [key, failure] of this.failures)
      if (failure.action === action) this.failures.delete(key);
    for (const [key, signal] of this.signals)
      if (signal.action === action) this.signals.delete(key);
  }
  validation(action: FeedbackAction) {
    this.recordFailure(action, 'validation_repeat');
  }
  failure(action: FeedbackAction, kind: 'operation' | 'network') {
    this.recordFailure(action, kind === 'network' ? 'network_repeat' : 'operation_repeat');
  }
  private recordFailure(action: FeedbackAction, type: FailureReason) {
    if (!this.enabled) return;
    this.acknowledge(action);
    const time = this.clock();
    const key = `${type}:${action}`;
    const times = [
      ...(this.failures.get(key)?.times ?? []).filter((t) => time - t < 60000),
      time,
    ].slice(type === 'validation_repeat' ? -3 : -2);
    this.failures.set(key, { type, action, times });
  }
  navigate(screen: string) {
    if (!this.enabled) return;
    const time = this.clock();
    if (this.routes.at(-1)?.screen === screen) return;
    this.progress('phase');
    this.routes = [...this.routes.filter((r) => time - r.time < 60000), { screen, time }].slice(-4);
    const [a, b, c, d] = this.routes;
    if (d && a.screen === c.screen && b.screen === d.screen && a.screen !== b.screen)
      this.signals.set('navigation_loop:phase', {
        type: 'navigation_loop',
        action: 'phase',
        time,
        score: 2,
      });
  }
  evaluate(): { total: number; reasons: FeedbackInput['reasons'] } {
    const time = this.clock();
    for (const [action, clicks] of this.clicks) {
      if (clicks.length === 4 && time - clicks[3] >= 1000 && time - clicks[3] < 60000) {
        this.signals.set(`rage_click:${action}`, {
          type: 'rage_click',
          action,
          time: clicks[3],
          score: 3,
        });
        this.clicks.delete(action);
      } else if (time - clicks.at(-1)! >= 60000) this.clicks.delete(action);
    }
    for (const [key, signal] of this.signals)
      if (time - signal.time >= 60000) this.signals.delete(key);
    const signals = [...this.signals.values()];
    for (const [key, failure] of this.failures) {
      failure.times = failure.times.filter((t) => time - t < 60000);
      if (!failure.times.length) {
        this.failures.delete(key);
        continue;
      }
      if (failure.times.length >= 2)
        signals.push({
          type: failure.type,
          action: failure.action,
          time: failure.times.at(-1)!,
          score:
            failure.type === 'validation_repeat' && failure.times.length >= 3
              ? 3
              : scores[failure.type],
        });
    }
    // One score per reason; retain per-action histories so a success clears only related trouble.
    const unique = new Map<FeedbackReason, ScoredSignal>();
    for (const signal of signals) {
      const previous = unique.get(signal.type);
      if (
        !previous ||
        signal.score > previous.score ||
        (signal.score === previous.score && signal.time > previous.time)
      )
        unique.set(signal.type, signal);
    }
    return {
      total: [...unique.values()].reduce((sum, signal) => sum + signal.score, 0),
      reasons: [...unique.values()].map(({ type, action }) => ({ type, action })),
    };
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export class FeedbackFrequency {
  private shown = false;
  constructor(
    private local: StorageLike,
    private session: StorageLike,
    private clock = Date.now,
  ) {}
  canShow() {
    if (this.shown) return false;
    try {
      return (
        !this.session.getItem('pufi-shown') &&
        this.clock() >= Number(this.local.getItem('pufi-until') ?? 0)
      );
    } catch {
      return false;
    } // Storage unavailable: keep automatic prompts off.
  }
  markShown(dismissed = false) {
    this.shown = true;
    try {
      this.session.setItem('pufi-shown', '1');
      this.local.setItem('pufi-until', String(this.clock() + (dismissed ? 7 : 1) * 86400000));
    } catch {
      /* Manual feedback remains available. */
    }
  }
}
