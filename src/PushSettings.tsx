import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, send } from './api';
import { t, useLanguage } from './i18n';

function supported() {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
function applicationKey(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export default function PushSettings() {
  useLanguage();
  const [config, setConfig] = useState<{ available: boolean; publicKey: string | null } | null>(
    null,
  );
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState(supported() ? Notification.permission : 'default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    const settings = await api<{ available: boolean; publicKey: string | null }>('/api/v1/push');
    setConfig(settings);
    if (supported()) {
      setPermission(Notification.permission);
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      const state = subscription
        ? await send<{ subscribed: boolean }>('/api/v1/push/status', {
            endpoint: subscription.endpoint,
          })
        : { subscribed: false };
      setSubscribed(state.subscribed);
    }
    setLoaded(true);
  };
  useEffect(() => {
    void refresh().catch(() => {
      setError(t('push.error'));
    });
  }, []);
  const change = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (subscribed) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          // Stop server deliveries first, even when the browser's unsubscribe later fails.
          await send('/api/v1/push/subscription', { endpoint: subscription.endpoint }, 'DELETE');
          await subscription.unsubscribe();
        }
      } else {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== 'granted') return;
        const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const wanted = applicationKey(config!.publicKey!);
        if (
          subscription &&
          String(new Uint8Array(subscription.options.applicationServerKey!)) !== String(wanted)
        ) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: wanted,
        });
        await send('/api/v1/push/subscription', subscription.toJSON(), 'PUT');
      }
    } catch {
      setError(t('push.error'));
    } finally {
      await refresh().catch(() => setError(t('push.error')));
      setBusy(false);
    }
  };
  return (
    <section
      className="push-settings profile-card"
      aria-labelledby="push-settings-title"
      aria-busy={busy}
    >
      <h2 id="push-settings-title">
        <Bell size={19} aria-hidden="true" />
        {t('push.title')}
      </h2>
      <p>{t('push.description')}</p>
      <p className="muted">{t('push.device_hint')}</p>
      {!supported() ? (
        <p>{t('push.unsupported')}</p>
      ) : !loaded ? (
        <p>{t('push.loading')}</p>
      ) : !config?.available && !subscribed ? (
        <p>{t('push.unconfigured')}</p>
      ) : (
        <>
          <p role="status">{t(subscribed && permission === 'granted' ? 'push.on' : 'push.off')}</p>
          {permission === 'denied' && <p>{t('push.denied')}</p>}
          <button
            className="button secondary"
            disabled={busy || (!subscribed && (permission === 'denied' || !config?.available))}
            onClick={() => void change()}
          >
            {t(subscribed ? 'push.disable' : 'push.enable')}
          </button>
        </>
      )}
      <details>
        <summary>{t('push.iphone_title')}</summary>
        <p>{t('push.iphone')}</p>
      </details>
      {error && (
        <p role="alert" className="form-error">
          {error}{' '}
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              void refresh()
                .then(() => setError(''))
                .catch(() => setError(t('push.error')))
            }
          >
            {t('push.retry')}
          </button>
        </p>
      )}
    </section>
  );
}
