import { Check, ArrowRight } from 'lucide-react';
import { t, useLanguage } from './i18n';

export default function FirstSteps({
  done,
  onProject,
  onStock,
  onQuestion,
}: {
  done: [boolean, boolean, boolean];
  onProject: () => void;
  onStock: () => void;
  onQuestion: () => void;
}) {
  useLanguage();
  const next = done.findIndex((value) => !value);
  if (next === -1) return null;
  const steps = [
    [t('first_steps.project'), t('ui.app.create_project'), onProject],
    [t('first_steps.stock'), t('ui.app.save_your_first_article'), onStock],
    [t('first_steps.question'), t('ui.app.add_question_or_insight'), onQuestion],
  ] as const;
  return (
    <section className="first-steps" aria-label={t('first_steps.title')}>
      <h2>{done[0] ? t('first_steps.title') : t('first_steps.start_project')}</h2>
      <p>{done[0] ? t('first_steps.intro') : t('first_steps.project_intro')}</p>
      <ol>
        {steps.map(([label], index) => (
          <li key={index} aria-current={index === next ? 'step' : undefined}>
            <span className="first-step-mark" aria-hidden="true">
              {done[index] ? <Check size={16} /> : index + 1}
            </span>
            <span>{label}</span>
            {done[index] && <span className="first-step-done">{t('first_steps.done')}</span>}
          </li>
        ))}
      </ol>
      <button className="button primary" onClick={steps[next][2]}>
        <ArrowRight size={17} aria-hidden="true" />
        {steps[next][1]}
      </button>
    </section>
  );
}
