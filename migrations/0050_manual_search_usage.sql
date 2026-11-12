-- Anonymous daily inference receipts survive account deletion, without retaining questions.
CREATE TABLE manual_search_usage (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX manual_search_usage_created ON manual_search_usage(created_at);
