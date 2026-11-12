import type { FeedbackAction, FeedbackReason, FeedbackInput } from '../shared/feedback';

const scores: Record<FeedbackReason, number> = {
  rage_click: 3,
  navigation_loop: 2,
  validation_repeat: 2,
};
// All state stays in memory. Values and DOM text are never inspected or retained.
export class FeedbackDetector {
  private enabled = false;
  private clicks = new Map<FeedbackAction, number[]>();
  private errors = new Map<FeedbackAction, number[]>();
  private routes: { screen: string; time: number }[] = [];
  private signals = new Map<FeedbackReason, { action: FeedbackAction; time: number }>();
  constructor(private clock = Date.now) {}
  enable(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  reset() {
    this.clicks.clear();
    this.errors.clear();
    this.routes = [];
    this.signals.clear();
  }
  click(action: FeedbackAction) {
    if (!this.enabled) return;
    const time = this.clock();
    const recent = (this.clicks.get(action) ?? []).filter((t) => time - t < 8000);
    this.clicks.set(action, [...recent, time].slice(-4));
  }
  acknowledge(action: FeedbackAction) {
    this.clicks.delete(action);
    if (this.signals.get('rage_click')?.action === action) this.signals.delete('rage_click');
  }
  progress(action: FeedbackAction) {
    this.clicks.delete(action);
    this.errors.delete(action);
    for (const [reason, signal] of this.signals) {
      if (signal.action === action) this.signals.delete(reason);
    }
  }
  validation(action: FeedbackAction) {
    if (!this.enabled) return;
    this.clicks.delete(action);
    const time = this.clock();
    const recent = [...(this.errors.get(action) ?? []).filter((t) => time - t < 60000), time];
    this.errors.set(action, recent.slice(-2));
    if (recent.length >= 2) this.signals.set('validation_repeat', { action, time });
  }
  navigate(screen: string) {
    if (!this.enabled) return;
    const time = this.clock();
    if (this.routes.at(-1)?.screen === screen) return;
    this.progress('phase');
    this.routes = [...this.routes.filter((r) => time - r.time < 60000), { screen, time }].slice(-4);
    const [a, b, c, d] = this.routes;
    if (d && a.screen === c.screen && b.screen === d.screen && a.screen !== b.screen)
      this.signals.set('navigation_loop', { action: 'phase', time });
  }
  evaluate(): { total: number; reasons: FeedbackInput['reasons'] } {
    const time = this.clock();
    for (const [action, clicks] of this.clicks) {
      // A reaction has one second to arrive after the fourth click.
      if (clicks.length === 4 && time - clicks[3] >= 1000 && time - clicks[3] < 60000) {
        this.signals.set('rage_click', { action, time: clicks[3] });
        this.clicks.delete(action);
      } else if (time - clicks.at(-1)! >= 60000) this.clicks.delete(action);
    }
    for (const [reason, signal] of this.signals)
      if (time - signal.time >= 60000) this.signals.delete(reason);
    return {
      total: [...this.signals.keys()].reduce((total, type) => total + scores[type], 0),
      reasons: [...this.signals].map(([type, { action }]) => ({ type, action })),
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
