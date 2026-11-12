import { useEffect, useState } from 'react';
import { api } from './api';
import type { User } from '../shared/domain';
import type { Language } from '../shared/locale';
import type { FeedbackScreen } from '../shared/feedback';
import PufiFeedback from './PufiFeedback';
import { FeedbackDetector } from './feedback-detector';
import { monitorFeedback } from './feedback-monitor';

export default function FeedbackSurface({
  screen,
  manual = false,
  language,
}: {
  screen: FeedbackScreen;
  manual?: boolean;
  language?: Language;
}) {
  const [detector] = useState(() => new FeedbackDetector());
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => monitorFeedback(detector, setHost, setBlocked), [detector, screen]);
  return (
    <PufiFeedback
      key={screen}
      detector={detector}
      host={host}
      blocked={blocked}
      screen={screen}
      alwaysVisible={manual}
      language={language}
    />
  );
}

// The manual remains public; only an identity-confirmed registered session gets an entry.
export function ManualFeedback({ language }: { language?: Language }) {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      try {
        const { user } = await api<{ user: User }>('/api/v1/me', { signal: current.signal });
        if (active && !current.signal.aborted)
          setOwner(user.onboarding_completed_at ? user.id : null);
      } catch {
        if (active && !current.signal.aborted) setOwner(null);
      }
    };
    void refresh();
    const visible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return owner ? <FeedbackSurface key={owner} screen="manual" manual language={language} /> : null;
}
