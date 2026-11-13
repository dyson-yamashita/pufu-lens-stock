import type { FeedbackAction, FeedbackInput } from '../shared/feedback';

type FailureReason = 'validation_repeat' | 'operation_repeat' | 'network_repeat';
type Signal = {
  type: 'rage_click' | FailureReason;
  action: FeedbackAction;
  time: number;
  score: number;
};
// Local, bounded bookkeeping only. Keys are ephemeral control IDs or normalized API operation IDs.
export class FeedbackDetector {
  private enabled = false;
  private clicks = new Map<string, { action: FeedbackAction; times: number[] }>();
  private failures = new Map<
    string,
    { type: FailureReason; action: FeedbackAction; key: string; times: number[] }
  >();
  private signals = new Map<string, Signal>();
  constructor(private clock = Date.now) {}
  enable(value: boolean) {
    this.enabled = value;
    this.reset();
  }
  reset() {
    this.clicks.clear();
    this.failures.clear();
    this.signals.clear();
  }
  private bound<T>(map: Map<string, T>) {
    while (map.size > 200) map.delete(map.keys().next().value!);
  }
  click(action: FeedbackAction, key: string = action) {
    if (!this.enabled) return;
    const time = this.clock();
    this.clicks.set(key, {
      action,
      times: [...(this.clicks.get(key)?.times ?? []).filter((t) => time - t < 16000), time].slice(
        -4,
      ),
    });
    this.bound(this.clicks);
  }
  acknowledge(_action: FeedbackAction, key: string = _action) {
    this.clicks.delete(key);
    this.signals.delete(key);
  }
  progress(action: FeedbackAction, key: string = action) {
    this.acknowledge(action, key);
    for (const [id, failure] of this.failures) if (failure.key === key) this.failures.delete(id);
  }
  validation(action: FeedbackAction, key: string = action) {
    this.record(action, 'validation_repeat', key);
  }
  failure(action: FeedbackAction, kind: 'operation' | 'network', key: string = action) {
    this.record(action, kind === 'network' ? 'network_repeat' : 'operation_repeat', key);
  }
  private record(action: FeedbackAction, type: FailureReason, key: string) {
    if (!this.enabled) return;
    this.acknowledge(action, key);
    const time = this.clock(),
      id = `${type}:${key}`;
    const times = [
      ...(this.failures.get(id)?.times ?? []).filter((t) => time - t < 120000),
      time,
    ].slice(type === 'validation_repeat' ? -3 : -2);
    this.failures.set(id, { type, action, key, times });
    this.bound(this.failures);
  }
  evaluate(): { total: number; reasons: FeedbackInput['reasons'] } {
    const time = this.clock();
    for (const [key, clicks] of this.clicks) {
      const last = clicks.times.at(-1)!;
      if (clicks.times.length === 4 && time - last >= 1000 && time - last < 120000) {
        this.signals.set(key, { type: 'rage_click', action: clicks.action, time: last, score: 3 });
        this.clicks.delete(key);
        this.bound(this.signals);
      } else if (time - last >= 120000) this.clicks.delete(key);
    }
    for (const [key, signal] of this.signals)
      if (time - signal.time >= 120000) this.signals.delete(key);
    const signals = [...this.signals.values()];
    for (const [id, failure] of this.failures) {
      failure.times = failure.times.filter((t) => time - t < 120000);
      if (!failure.times.length) {
        this.failures.delete(id);
        continue;
      }
      if (failure.times.length >= 2)
        signals.push({
          type: failure.type,
          action: failure.action,
          time: failure.times.at(-1)!,
          score: failure.type === 'validation_repeat' && failure.times.length < 3 ? 2 : 3,
        });
    }
    const unique = new Map<Signal['type'], Signal>();
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
      total: [...unique.values()].reduce((sum, s) => sum + s.score, 0),
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
