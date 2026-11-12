import { expect, it } from 'vitest';
import { FeedbackDetector, FeedbackFrequency } from '../src/feedback-detector';
import { feedbackSchema } from '../shared/feedback';

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
  expect(detector.evaluate().total).toBe(0);
  detector.navigate('C');
  expect(detector.evaluate().total).toBe(0);
});

it('ordinary phase comparison stays below threshold; repeated searching can trigger alone', () => {
  const detector = new FeedbackDetector();
  detector.enable(true);
  for (const route of ['A', 'B', 'A', 'B']) detector.navigate(route);
  expect(detector.evaluate().total).toBe(2);
  detector.navigate('A');
  detector.navigate('B');
  expect(detector.evaluate()).toEqual({
    total: 3,
    reasons: [{ type: 'navigation_loop', action: 'phase' }],
  });
  detector.enable(false);
  expect(detector.evaluate().total).toBe(0);
});

it('recomputes alternating navigation from the current sixty-second window', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.enable(true);
  for (const route of ['A', 'B', 'A', 'B', 'A', 'B']) {
    detector.navigate(route);
    time += 5000;
  }
  expect(detector.evaluate().total).toBe(3);
  time = 165000;
  expect(detector.evaluate().total).toBe(2);
  time = 175000;
  expect(detector.evaluate().total).toBe(0);
});

it.each(['edit', 'import', 'download'] as const)(
  'repeatedly opening and leaving %s without progress reveals possible confusion',
  (action) => {
    const detector = new FeedbackDetector();
    detector.enable(true);
    detector.close(action);
    expect(detector.evaluate().total).toBe(0);
    for (let i = 0; i < 3; i++) {
      detector.open(action);
      detector.open(action);
      detector.close(action);
      detector.close(action);
      expect(detector.evaluate().total).toBe(i === 0 ? 0 : i === 1 ? 2 : 3);
    }
    expect(detector.evaluate().reasons).toEqual([{ type: 'exploration_repeat', action }]);
  },
);

it('meaningful input or success clears searching, and a completed action is not an abandoned visit', () => {
  const detector = new FeedbackDetector();
  detector.enable(true);
  for (const route of ['A', 'B', 'A', 'B']) detector.navigate(route);
  for (let i = 0; i < 2; i++) {
    detector.open('edit');
    detector.close('edit');
  }
  expect(detector.evaluate().total).toBe(4);
  detector.failure('save', 'operation');
  detector.failure('save', 'operation');
  detector.progress('edit');
  expect(detector.evaluate()).toEqual({
    total: 3,
    reasons: [{ type: 'operation_repeat', action: 'save' }],
  });
  detector.progress('save');
  for (let i = 0; i < 3; i++) {
    detector.open('edit');
    detector.progress('edit');
    detector.close('edit');
  }
  expect(detector.evaluate().total).toBe(0);
});

it('does not infer confusion from reading or waiting, and expires abandoned visits', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.open('edit');
  detector.close('edit');
  detector.enable(true);
  detector.open('edit');
  time += 3600000;
  expect(detector.evaluate().total).toBe(0);
  for (let i = 0; i < 3; i++) {
    detector.open('edit');
    detector.close('edit');
    time += 10000;
  }
  expect(detector.evaluate().total).toBe(3);
  time += 30000;
  expect(detector.evaluate().total).toBe(2);
  time += 10000;
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

it('keeps all six distinct fixed reasons within the feedback API contract', () => {
  let time = 100000;
  const detector = new FeedbackDetector(() => time);
  detector.enable(true);
  for (let i = 0; i < 3; i++) {
    detector.open('edit');
    detector.close('edit');
    detector.validation('import');
  }
  for (const route of ['A', 'B', 'A', 'B', 'A', 'B']) detector.navigate(route);
  for (let i = 0; i < 2; i++) {
    detector.failure('save', 'operation');
    detector.failure('save', 'network');
  }
  for (let i = 0; i < 4; i++) detector.click('download');
  time += 1500;
  const { reasons } = detector.evaluate();
  expect(reasons).toHaveLength(6);
  expect(
    feedbackSchema.safeParse({
      request_id: crypto.randomUUID(),
      owner_id: 'alice',
      screen: 'pufu-editor',
      category: 'navigation',
      detail: '',
      reasons,
      consent: true,
    }).success,
  ).toBe(true);
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
