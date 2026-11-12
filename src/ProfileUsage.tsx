import { useEffect, useState } from 'react';
import { Archive, CircleHelp, ListTree, Sparkles } from 'lucide-react';
import { api } from './api';
import { intlLocale, t, useLanguage } from './i18n';
import type { ProfileUsage as Usage, UsagePeriod } from '../shared/profile-usage';

export default function ProfileUsage({ userId }: { userId: string }) {
  useLanguage();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [period, setPeriod] = useState<UsagePeriod>('week');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setUsage(null);
    setFailed(false);
    api<Usage>('/api/v1/me/usage', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setUsage(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [userId, attempt]);
  const periods: { value: UsagePeriod; label: string }[] = [
    { value: 'week', label: t('ui.usage.week') },
    { value: 'month', label: t('ui.usage.month') },
    { value: 'all', label: t('ui.usage.all') },
  ];
  const metrics = [
    { key: 'stocks', label: t('ui.usage.stocks'), icon: Archive },
    { key: 'questions', label: t('ui.usage.questions'), icon: CircleHelp },
    { key: 'pufus', label: t('ui.usage.pufus'), icon: ListTree },
    { key: 'ai_calls', label: t('ui.usage.ai_calls'), icon: Sparkles },
  ] as const;
  const selected = usage?.periods[period];
  const date = (value: string) =>
    new Date(value).toLocaleDateString(intlLocale(), {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  return (
    <section className="profile-card usage-card" aria-labelledby="usage-heading">
      <h2 id="usage-heading">{t('ui.usage.title')}</h2>
      <fieldset className="usage-periods">
        <legend>{t('ui.usage.period')}</legend>
        {periods.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="usage-period"
              value={value}
              checked={period === value}
              onChange={() => setPeriod(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite" aria-busy={!usage && !failed}>
        {failed ? (
          <div className="usage-error" role="alert">
            <p>{t('ui.usage.failed')}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setAttempt(attempt + 1)}
            >
              {t('ui.usage.retry')}
            </button>
          </div>
        ) : selected && usage ? (
          <>
            <p className="profile-hint usage-range">
              {selected.since
                ? `${date(selected.since)} – ${date(usage.as_of)}`
                : t('ui.usage.all_time')}
            </p>
            <dl className="usage-metrics">
              {metrics.map(({ key, label, icon: Icon }) => (
                <div key={key} data-metric={key}>
                  <dt>
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </dt>
                  <dd>
                    <strong>{selected[key].toLocaleString(intlLocale())}</strong>
                    <span>
                      {key === 'ai_calls' ? t('ui.usage.calls_unit') : t('ui.usage.items_unit')}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="profile-hint">{t('ui.usage.loading')}</p>
        )}
      </div>
      <p className="profile-hint">{t('ui.usage.registration_note')}</p>
      <p className="profile-hint">{t('ui.usage.ai_note')}</p>
      <p className="profile-hint">{t('ui.usage.timezone_note')}</p>
    </section>
  );
}
