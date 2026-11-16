import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import type { Config, User } from '../../../shared/domain';
import { applicationError, applyAccountLanguage } from '../../i18n/i18n';
import { api, ApiError } from '../../lib/api';
export function useAppSession(setError: Dispatch<SetStateAction<string>>) {
  const [config, setConfig] = useState<Config | null>(null);

  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Config>('/api/config'),
      api<{
        user: User;
      }>('/api/v1/me').catch((e) => {
        if ((e as ApiError).status !== 401) throw e;
        return { user: null };
      }),
    ])
      .then(([settings, identity]) => {
        if (active) {
          setConfig(settings);
          applyAccountLanguage(identity.user);
          setUser(identity.user);
        }
      })
      .catch((e) => {
        if (active) setError(applicationError((e as Error).message));
      });
    return () => {
      active = false;
    };
  }, []);
  return { config, user, setUser };
}
