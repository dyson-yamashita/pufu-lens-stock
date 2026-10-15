import type { Question } from '../shared/domain';

export default function QuestionLabels({
  question,
  className = '',
}: {
  question: Pick<Question, 'source' | 'has_pufu'>;
  className?: string;
}) {
  return (
    <div className={`question-labels ${className}`}>
      <span className={`question-origin question-origin-${question.source}`}>
        {question.source === 'user' ? 'ユーザー' : 'AI'}
      </span>
      {question.has_pufu === 1 && (
        <span className="question-origin question-origin-pufu">プ譜</span>
      )}
    </div>
  );
}
