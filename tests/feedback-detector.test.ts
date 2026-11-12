import { expect, it } from 'vitest';
import { FeedbackDetector, FeedbackFrequency } from '../src/feedback-detector';

it('requires opt-in and four unacknowledged clicks in eight seconds, then expires after sixty seconds', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  for (let i = 0; i < 4; i++) detector.click('save');
  expect(detector.evaluate().total).toBe(0);
  detector.enable(true);
  for (let i = 0; i < 4; i++) {
    detector.click('save');
    time += 100;
  }
  expect(detector.evaluate().total).toBe(0);
  time += 1000;
  expect(detector.evaluate()).toEqual({
    total: 3,
    reasons: [{ type: 'rage_click', action: 'save' }],
  });
  time += 60000;
  expect(detector.evaluate().total).toBe(0);
  for (let i = 0; i < 4; i++) {
    detector.click('save');
    time += 3000;
  }
  expect(detector.evaluate().total).toBe(0);
});

it('acknowledgment prevents rage clicks without clearing repeated validation; success clears related signals', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.enable(true);
  for (let i = 0; i < 4; i++) {
    detector.click('import');
    detector.acknowledge('import');
  }
  time += 1500;
  expect(detector.evaluate().total).toBe(0);
  for (let i = 0; i < 2; i++) detector.validation('import');
  expect(detector.evaluate().total).toBe(2);
  detector.acknowledge('import');
  expect(detector.evaluate().total).toBe(2);
  detector.navigate('A');
  detector.navigate('B');
  detector.navigate('A');
  detector.navigate('B');
  expect(detector.evaluate().total).toBe(4);
  detector.progress('import');
  expect(detector.evaluate().total).toBe(2);
  detector.navigate('C');
  expect(detector.evaluate().total).toBe(0);
});

it('normal phase navigation alone does not reach the display threshold; disabling clears state', () => {
  const detector = new FeedbackDetector();
  detector.enable(true);
  for (const route of ['A', 'B', 'A', 'B', 'A', 'B']) detector.navigate(route);
  expect(detector.evaluate().total).toBe(2);
  detector.enable(false);
  expect(detector.evaluate().total).toBe(0);
});

it('three validation errors on one action trigger alone without unbounded score inflation', () => {
  const detector = new FeedbackDetector();
  detector.enable(true);
  detector.validation('import');
  expect(detector.evaluate().total).toBe(0);
  detector.validation('import');
  expect(detector.evaluate().total).toBe(2);
  detector.validation('import');
  expect(detector.evaluate()).toEqual({
    total: 3,
    reasons: [{ type: 'validation_repeat', action: 'import' }],
  });
  for (let i = 0; i < 7; i++) detector.validation('import');
  expect(detector.evaluate().total).toBe(3);
  detector.progress('import');
  expect(detector.evaluate().total).toBe(0);
});

it('counts only validation errors in the rolling sixty-second window', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.enable(true);
  detector.validation('import');
  time += 10000;
  detector.validation('import');
  time += 10000;
  detector.validation('import');
  expect(detector.evaluate().total).toBe(3);
  time += 40000;
  expect(detector.evaluate().total).toBe(2);
  time += 10000;
  expect(detector.evaluate().total).toBe(0);
});

it.each(['operation', 'network'] as const)(
  'two acknowledged save failures trigger and preserve a distinct %s reason',
  (kind) => {
    const detector = new FeedbackDetector();
    detector.enable(true);
    for (let i = 0; i < 2; i++) {
      detector.click('save');
      detector.acknowledge('save');
      detector.failure('save', kind);
    }
    expect(detector.evaluate()).toEqual({
      total: 3,
      reasons: [{ type: `${kind}_repeat`, action: 'save' }],
    });
    detector.progress('save');
    expect(detector.evaluate().total).toBe(0);
    detector.failure('save', kind);
    expect(detector.evaluate().total).toBe(0);
  },
);

it('success clears only the related action and identical failure types across actions are not double-scored', () => {
  const detector = new FeedbackDetector();
  detector.enable(true);
  detector.validation('import');
  detector.validation('import');
  detector.validation('save');
  detector.validation('save');
  expect(detector.evaluate().total).toBe(2);
  detector.validation('save');
  expect(detector.evaluate().total).toBe(3);
  detector.progress('save');
  expect(detector.evaluate()).toEqual({
    total: 2,
    reasons: [{ type: 'validation_repeat', action: 'import' }],
  });
});

it('failure events remain inactive before consent and expire after sixty seconds', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.failure('save', 'operation');
  detector.failure('save', 'operation');
  expect(detector.evaluate().total).toBe(0);
  detector.enable(true);
  detector.failure('save', 'operation');
  detector.failure('save', 'operation');
  expect(detector.evaluate().total).toBe(3);
  time += 60000;
  expect(detector.evaluate().total).toBe(0);
});

it('shares the 24-hour and seven-day cooldown across tabs and keeps the once-per-session limit', () => {
  let time = 100000;
  const storage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  };
  const local = storage();
  const session = storage();
  const first = new FeedbackFrequency(local, session, () => time);
  expect(first.canShow()).toBe(true);
  first.markShown();
  expect(new FeedbackFrequency(local, storage(), () => time).canShow()).toBe(false);
  time += 86400000;
  expect(first.canShow()).toBe(false);
  expect(new FeedbackFrequency(local, session, () => time).canShow()).toBe(false);
  const next = new FeedbackFrequency(local, storage(), () => time);
  expect(next.canShow()).toBe(true);
  next.markShown(true);
  time += 6 * 86400000;
  expect(new FeedbackFrequency(local, storage(), () => time).canShow()).toBe(false);
  time += 86400000;
  expect(new FeedbackFrequency(local, storage(), () => time).canShow()).toBe(true);
});
