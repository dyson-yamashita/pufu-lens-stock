-- Keep counts without prompts/results after the 30-day attempt cleanup.
CREATE INDEX pufu_usage_owner ON pufu_scores(user_id, created_at);
-- statement-breakpoint
CREATE TABLE ai_usage_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL CHECK (calls > 0),
  PRIMARY KEY (user_id, day)
);
-- statement-breakpoint
INSERT INTO ai_usage_daily (user_id, day, calls)
SELECT user_id, date(created_at, '+9 hours'), COUNT(*)
FROM ai_attempts GROUP BY user_id, date(created_at, '+9 hours');
-- statement-breakpoint
CREATE TRIGGER record_ai_usage AFTER INSERT ON ai_attempts
BEGIN
  INSERT INTO ai_usage_daily (user_id, day, calls)
  VALUES (NEW.user_id, date(NEW.created_at, '+9 hours'), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1;
END;
