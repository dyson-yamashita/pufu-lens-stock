import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function useResource<T>(path: string) {
  const [state, setState] = useState<{
    path: string;
    data?: T;
    error?: string;
  }>({ path });
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ path, data });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setState({ path, error: e.message });
      });
    return () => controller.abort();
  }, [path, retry]);
  return { ...(state.path === path ? state : { path }), reload };
}
