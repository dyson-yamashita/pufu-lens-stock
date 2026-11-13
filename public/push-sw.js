/* global self, URL */
/* Push only: no fetch handler, offline caching or private API response storage. */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    /* Display a safe fallback below. */
  }
  const url =
    typeof data?.url === 'string' && /^\/#announcements\/[a-zA-Z0-9_-]+$/.test(data.url)
      ? data.url
      : '/#announcements';
  event.waitUntil(
    self.registration.showNotification(typeof data?.title === 'string' ? data.title : 'Pufu Lens', {
      body: typeof data?.body === 'string' ? data.body : 'Pufu Lens',
      icon: '/pufu-lens-logo.png',
      badge: '/pufu-lens-logo.png',
      tag: typeof data?.tag === 'string' ? data.tag : 'pufu-announcement',
      data: { url },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data?.url;
  const path =
    typeof raw === 'string' && /^\/#announcements(?:\/[a-zA-Z0-9_-]+)?$/.test(raw)
      ? raw
      : '/#announcements';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (client) {
        await client.navigate(url);
        await client.focus();
      } else await self.clients.openWindow(url);
    })(),
  );
});
