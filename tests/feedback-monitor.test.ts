import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { FeedbackDetector } from '../src/feedback-detector';
import { monitorFeedback } from '../src/feedback-monitor';
import { beginFeedbackRequest, feedbackRequestKey, reportFeedback } from '../src/feedback-events';
let document: Document, detector: FeedbackDetector, stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  const dom = parseHTML(
    '<html><body><main><button id="a">A</button><button id="b">B</button></main></body></html>',
  );
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  detector = new FeedbackDetector();
  stop = monitorFeedback(
    detector,
    () => {},
    () => {},
  );
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const click = (id = 'a') =>
  document.getElementById(id)!.dispatchEvent(new window.Event('click', { bubbles: true }));
it('detects a truly unresponsive control anywhere, but treats a screen update as a response', async () => {
  for (let i = 0; i < 4; i++) {
    click();
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(1500);
  expect(detector.evaluate().reasons).toEqual([{ type: 'rage_click', action: 'control' }]);
  detector.reset();
  for (let i = 0; i < 4; i++) {
    click();
    document.getElementById('a')!.setAttribute('aria-busy', String(i % 2 === 0));
    await Promise.resolve();
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(1500);
  expect(detector.evaluate().total).toBe(0);
});
it('tracks API failures and successes without request content, and ignores aborted work', () => {
  let end = beginFeedbackRequest('/api/v1/stocks/private-id?secret=value', 'POST');
  end('operation');
  end = beginFeedbackRequest('/api/v1/stocks/another-id', 'POST');
  end('operation');
  expect(detector.evaluate().reasons).toEqual([{ type: 'operation_repeat', action: 'request' }]);
  end = beginFeedbackRequest('/api/v1/stocks/new-id', 'POST');
  end('success');
  expect(detector.evaluate().total).toBe(0);
  end = beginFeedbackRequest('/api/v1/stocks/new-id', 'POST');
  end('ignore');
  expect(detector.evaluate().total).toBe(0);
});
it('normalizes API keys and excludes identity and feedback so the assistant cannot trigger itself', () => {
  expect(feedbackRequestKey('/api/v1/stocks/private-id?text=secret', 'PATCH')).toBe(
    'PATCH:stocks/:id',
  );
  expect(feedbackRequestKey('/api/v1/feedback/manual-search', 'POST')).toBeNull();
  expect(feedbackRequestKey('/api/v1/me', 'GET')).toBeNull();
});
it('keeps native validation on separate inputs and stops monitoring on logout cleanup', () => {
  const field = document.createElement('input');
  document.body.appendChild(field);
  for (let i = 0; i < 3; i++) {
    click();
    field.dispatchEvent(new window.Event('invalid', { bubbles: true }));
  }
  expect(detector.evaluate().total).toBe(3);
  stop();
  expect(detector.evaluate().total).toBe(0);
});

it('clears related local and native validation after a successful save, preserving other forms', () => {
  document.body.innerHTML =
    '<form><input id="field"><button id="save" data-feedback-action="save">Save</button></form><form><input id="other"></form>';
  const invalid = (name: string) =>
    document.getElementById(name)!.dispatchEvent(new window.Event('invalid', { bubbles: true }));
  for (let i = 0; i < 2; i++) {
    click('save');
    invalid('field');
    reportFeedback('save', 'validation');
  }
  // A successful background poll must not clear a user's failed form submission.
  beginFeedbackRequest('/api/v1/stocks', 'GET')('success');
  expect(detector.evaluate().total).toBe(2);
  click('save');
  invalid('other');
  const end = beginFeedbackRequest('/api/v1/pufus/private-id', 'PATCH');
  end('success');
  click('save');
  invalid('field');
  reportFeedback('save', 'validation');
  expect(detector.evaluate().total).toBe(0);
  click('save');
  invalid('other');
  expect(detector.evaluate().total).toBe(2);
});
