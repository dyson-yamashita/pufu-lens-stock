import { t, useLanguage } from './i18n';
import type { Question } from '../shared/domain';
export default function QuestionLabels({
  question,
  className = '',
}: {
  question: Pick<Question, 'source' | 'has_pufu'>;
  className?: string;
}) {
  useLanguage();
  return (
    <div className={`question-labels ${className}`}>
      <span className={`question-origin question-origin-${question.source}`}>
        {question.source === 'user' ? t('ui.app.user') : 'AI'}
      </span>
      {question.has_pufu === 1 && (
        <span className="question-origin question-origin-pufu">{t('ui.app.pufu')}</span>
      )}
    </div>
  );
}
