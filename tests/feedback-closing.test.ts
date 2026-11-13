import { expect, it } from 'vitest';
import { feedbackClosingTopic } from '../src/feedback-closing';

it.each([
  [['マニュアルの困ったときはの文章が長くで読みづらいです。'], 'manual'],
  [['保存ボタンが反応しません', '画面が切り替わってほしい'], 'save'],
  [['困っています', '入力できません'], 'input'],
  [['The manual is hard to read'], 'manual'],
  [['Searching takes too long'], 'search'],
  [['ログインしてから保存ができません'], 'login'],
  [['ありがとうございます'], null],
  [['Manually tried it'], null],
  [[], null],
])('selects a topic only from the supplied user text: %j', (messages, topic) => {
  expect(feedbackClosingTopic(messages)).toBe(topic);
});
