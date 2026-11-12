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
  for (let i = 0; i < 4; i++) detector.validation('import');
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
