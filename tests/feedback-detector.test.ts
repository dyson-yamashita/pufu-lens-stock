import { expect, it } from 'vitest';
import { FeedbackDetector, FeedbackFrequency } from '../src/feedback-detector';

it('counts only unacknowledged repetitions on the same control', () => {
  let time = 100000;
  const d = new FeedbackDetector(() => time);
  d.enable(true);
  for (let i = 0; i < 4; i++) d.click('control', `button-${i}`);
  time += 1500;
  expect(d.evaluate().total).toBe(0);
  for (let i = 0; i < 4; i++) d.click('control', 'same');
  expect(d.evaluate().total).toBe(0);
  time += 1500;
  expect(d.evaluate()).toEqual({ total: 3, reasons: [{ type: 'rage_click', action: 'control' }] });
  d.acknowledge('control', 'same');
  expect(d.evaluate().total).toBe(0);
});

it('keeps unrelated requests separate and clears only the successful operation', () => {
  const d = new FeedbackDetector();
  d.enable(true);
  d.failure('request', 'operation', 'POST stocks');
  d.failure('request', 'operation', 'PATCH projects');
  expect(d.evaluate().total).toBe(0);
  d.failure('request', 'operation', 'POST stocks');
  expect(d.evaluate().total).toBe(3);
  d.progress('request', 'PATCH projects');
  expect(d.evaluate().total).toBe(3);
  d.progress('request', 'POST stocks');
  expect(d.evaluate().total).toBe(0);
});

it('requires three repeated validation errors on one input, without adding the same reason twice', () => {
  const d = new FeedbackDetector();
  d.enable(true);
  d.validation('input', 'field-a');
  d.validation('input', 'field-b');
  expect(d.evaluate().total).toBe(0);
  d.validation('input', 'field-a');
  expect(d.evaluate().total).toBe(2);
  d.validation('input', 'field-a');
  d.validation('input', 'field-b');
  expect(d.evaluate().total).toBe(3);
  d.progress('input', 'field-a');
  expect(d.evaluate().total).toBe(2);
});

it.each(['operation', 'network'] as const)(
  'counts repeated %s failures and expires in sixty seconds',
  (kind) => {
    let time = 100000;
    const d = new FeedbackDetector(() => time);
    d.enable(true);
    d.failure('request', kind, 'same');
    time += 10000;
    d.failure('request', kind, 'same');
    expect(d.evaluate().reasons).toEqual([{ type: `${kind}_repeat`, action: 'request' }]);
    time += 50000;
    expect(d.evaluate().total).toBe(0);
  },
);

it('does not infer trouble from waiting, normal clicks, or a disabled session', () => {
  let time = 100000;
  const d = new FeedbackDetector(() => time);
  d.enable(true);
  for (let i = 0; i < 10; i++) {
    d.click('control', 'same');
    d.acknowledge('control', 'same');
  }
  time += 3600000;
  expect(d.evaluate().total).toBe(0);
  d.enable(false);
  for (let i = 0; i < 3; i++) d.validation('input', 'same');
  expect(d.evaluate().total).toBe(0);
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
