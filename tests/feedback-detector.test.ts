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
  'counts repeated %s failures and expires in 120 seconds',
  (kind) => {
    let time = 100000;
    const d = new FeedbackDetector(() => time);
    d.enable(true);
    d.failure('request', kind, 'same');
    time += 90000;
    d.failure('request', kind, 'same');
    expect(d.evaluate().reasons).toEqual([{ type: `${kind}_repeat`, action: 'request' }]);
    time += 29999;
    expect(d.evaluate().total).toBe(3);
    time += 1;
    expect(d.evaluate().total).toBe(0);
  },
);

it('counts three validation errors over 90 seconds and expires the first at 120 seconds', () => {
  let time = 100000;
  const d = new FeedbackDetector(() => time);
  d.enable(true);
  d.validation('input', 'same');
  time += 45000;
  d.validation('input', 'same');
  time += 45000;
  d.validation('input', 'same');
  expect(d.evaluate().total).toBe(3);
  time += 29999;
  expect(d.evaluate().total).toBe(3);
  time += 1;
  expect(d.evaluate().total).toBe(2);
});

it.each([
  { span: 15999, detected: true },
  { span: 16000, detected: false },
])('counts four clicks only within 16 seconds: $span ms', ({ span, detected }) => {
  let time = 100000;
  const d = new FeedbackDetector(() => time);
  d.enable(true);
  d.click('control', 'same');
  time += span / 3;
  d.click('control', 'same');
  time += span / 3;
  d.click('control', 'same');
  time = 100000 + span;
  d.click('control', 'same');
  time += 1000;
  expect(d.evaluate().total).toBe(detected ? 3 : 0);
});

it('retains an unacknowledged click signal for 120 seconds after the last click', () => {
  let time = 100000;
  const d = new FeedbackDetector(() => time);
  d.enable(true);
  for (let i = 0; i < 4; i++) d.click('control', 'same');
  time += 90000;
  expect(d.evaluate().total).toBe(3);
  time += 29999;
  expect(d.evaluate().total).toBe(3);
  time += 1;
  expect(d.evaluate().total).toBe(0);
});

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
