-- Keep the initial announcement consistent with the profile-only notification settings.
-- Preserve operator edits and never change notification delivery flags.
UPDATE announcements
SET ja_json=json_set(ja_json,'$.paragraphs[1]','対応する端末では、プロフィールの「通知設定」でPush通知を有効にできます。通知は任意です。通知を有効にしなくても、すべてのお知らせを読めます。')
WHERE id='2026-11-announcements'
  AND json_extract(ja_json,'$.paragraphs[1]')='対応する端末では、このページまたはプロフィールでPush通知を有効にできます。通知は任意です。通知を有効にしなくても、すべてのお知らせを読めます。';

UPDATE announcements
SET en_json=json_set(en_json,'$.paragraphs[1]','On supported devices, enable push notifications in Profile under Notification settings. Notifications are optional. All announcements remain available without enabling notifications.')
WHERE id='2026-11-announcements'
  AND json_extract(en_json,'$.paragraphs[1]')='On supported devices, enable push notifications here or in your profile. Notifications are optional. All announcements remain available without enabling notifications.';
