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
  const status = !supported()
    ? 'push.unsupported'
    : !loaded
      ? error
        ? null
        : 'push.loading'
      : !config?.available && !subscribed
        ? 'push.unconfigured'
        : permission === 'denied'
          ? 'push.denied'
          : null;
  return (
    <section
      className="push-settings profile-card"
      aria-labelledby="push-settings-title"
      aria-busy={busy}
    >
      <div className="push-settings-row">
        <span className="push-settings-icon" aria-hidden="true">
          <Bell size={23} />
        </span>
        <div className="push-settings-copy">
          <h2 id="push-settings-title">{t('push.title')}</h2>
          <p id="push-settings-description">{t('push.description')}</p>
        </div>
        <button
          type="button"
          className="push-switch"
          role="switch"
          aria-labelledby="push-settings-title"
          aria-describedby="push-settings-description"
          aria-checked={subscribed}
          disabled={
            busy ||
            !loaded ||
            !supported() ||
            (!subscribed && (permission === 'denied' || !config?.available))
          }
          onClick={() => void change()}
        >
          <span className="push-switch-track" aria-hidden="true">
            <span className="push-switch-thumb" />
          </span>
        </button>
      </div>
      {status && (
        <p className="push-settings-status muted" role="status">
          {t(status)}
        </p>
      )}
      <details className="push-settings-help">
        <summary>{t('push.about')}</summary>
        <p>{t('push.device_hint')}</p>
        <h3>{t('push.iphone_title')}</h3>
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
