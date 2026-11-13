CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('feature','maintenance','important')),
  published_at TEXT,
  notify INTEGER NOT NULL DEFAULT 0 CHECK(notify IN (0,1)),
  notify_at TEXT,
  ja_json TEXT NOT NULL CHECK(json_valid(ja_json)),
  en_json TEXT NOT NULL CHECK(json_valid(en_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((notify=0 AND notify_at IS NULL) OR (notify=1 AND notify_at IS NOT NULL AND published_at IS NOT NULL AND notify_at>=published_at))
);
CREATE INDEX announcements_public ON announcements(published_at);
CREATE INDEX announcements_notification ON announcements(notify,notify_at);
INSERT INTO announcements(id,category,published_at,notify,notify_at,ja_json,en_json)
VALUES ('2026-11-announcements','feature','2026-11-13T00:00:00.000Z',0,NULL,'{"title":"お知らせページを追加しました","summary":"新機能やメンテナンスなど、Pufu Lensからのご案内をこちらに掲載します。","paragraphs":["サイドバーの「お知らせ」から、Pufu Lensの新機能や重要なご案内を確認できます。","対応する端末では、このページまたはプロフィールでPush通知を有効にできます。通知は任意です。通知を有効にしなくても、すべてのお知らせを読めます。","通知の利用準備が完了するまでは設定画面にその旨が表示されます。"]}','{"title":"Introducing announcements","summary":"Find new features, maintenance updates, and news from Pufu Lens here.","paragraphs":["Open Announcements in the sidebar to read about new features and important updates.","On supported devices, enable push notifications here or in your profile. Notifications are optional. All announcements remain available without enabling notifications.","The settings panel indicates when notification service setup is still pending."]}');

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX push_subscriptions_owner ON push_subscriptions(user_id);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session_hash);
CREATE TABLE push_deliveries (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lease TEXT,
  last_status INTEGER,
  PRIMARY KEY (announcement_id, subscription_id)
);
CREATE INDEX push_deliveries_pending ON push_deliveries(status,next_attempt_at);
