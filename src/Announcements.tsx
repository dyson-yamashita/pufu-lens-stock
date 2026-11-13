import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { intlLocale, t, useLanguage } from './i18n';
import { announcementHref, type Announcement } from '../shared/announcements';
import PushSettings from './PushSettings';

export default function Announcements({ id }: { id?: string }) {
  const { language } = useLanguage();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const load = () => {
    setError(false);
    const version = ++request.current;
    void api<{ announcements: Announcement[] }>(
      id ? `/api/v1/announcements/${encodeURIComponent(id)}` : '/api/v1/announcements',
    )
      .then((result) => {
        if (request.current === version) setItems(result.announcements);
      })
      .catch((error: unknown) => {
        if (request.current !== version) return;
        if (id && error instanceof ApiError && error.status === 404) setItems([]);
        else setError(true);
      });
  };
  useEffect(() => {
    setItems(null);
    load();
    return () => {
      request.current++;
    };
  }, [id]);
  const item = items?.find((item) => item.id === id);
  return (
    <div className="announcements-page">
      <PushSettings />
      {error ? (
        <p role="alert">
          {t('announcements.error')}{' '}
          <button className="button secondary" onClick={load}>
            {t('push.retry')}
          </button>
        </p>
      ) : !items ? (
        <p>{t('push.loading')}</p>
      ) : id ? (
        <>
          <a className="text-link" href="#announcements">
            {t('announcements.back')}
          </a>
          {item ? (
            <article className="announcement-card">
              <p className="muted">
                <time dateTime={item.publishedAt!}>
                  {new Date(item.publishedAt!).toLocaleDateString(intlLocale(), {
                    timeZone: 'Asia/Tokyo',
                  })}
                </time>{' '}
                · {t(`announcements.${item.category}`)}
              </p>
              <h2>{item[language].title}</h2>
              {item[language].paragraphs.map((text, index) => (
                <p key={index}>{text}</p>
              ))}
            </article>
          ) : (
            <p role="status">{t('announcements.not_found')}</p>
          )}
        </>
      ) : (
        <section aria-label={t('announcements.title')} className="announcements-list">
          {items.length ? (
            items.map((item) => (
              <article key={item.id} className="announcement-card">
                <p className="muted">
                  <time dateTime={item.publishedAt!}>
                    {new Date(item.publishedAt!).toLocaleDateString(intlLocale(), {
                      timeZone: 'Asia/Tokyo',
                    })}
                  </time>{' '}
                  · {t(`announcements.${item.category}`)}
                </p>
                <h2>
                  <a href={announcementHref(item.id)}>{item[language].title}</a>
                </h2>
                <p>{item[language].summary}</p>
              </article>
            ))
          ) : (
            <p>{t('announcements.empty')}</p>
          )}
        </section>
      )}
    </div>
  );
}
