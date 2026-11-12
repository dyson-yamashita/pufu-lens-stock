ALTER TABLE ai_attempts ADD COLUMN usage_model TEXT;
-- statement-breakpoint
ALTER TABLE ai_attempts ADD COLUMN neurons_micros INTEGER CHECK (neurons_micros >= 0);
-- statement-breakpoint
ALTER TABLE ai_attempts ADD COLUMN usage_complete INTEGER NOT NULL DEFAULT 0 CHECK (usage_complete IN (0,1));
-- statement-breakpoint
ALTER TABLE ai_usage_daily ADD COLUMN neurons_micros INTEGER NOT NULL DEFAULT 0 CHECK (neurons_micros >= 0);
-- statement-breakpoint
ALTER TABLE ai_usage_daily ADD COLUMN measured_calls INTEGER NOT NULL DEFAULT 0 CHECK (measured_calls >= 0 AND measured_calls <= calls);
-- statement-breakpoint
-- Old attempts stay unmeasured; a call count cannot be converted to Neurons.
-- Only update an existing daily row so late responses cannot recreate withdrawn users.
CREATE TRIGGER record_ai_neurons AFTER UPDATE OF neurons_micros, usage_complete ON ai_attempts
BEGIN
  UPDATE ai_usage_daily SET
    neurons_micros = neurons_micros + COALESCE(NEW.neurons_micros,0) - COALESCE(OLD.neurons_micros,0),
    measured_calls = measured_calls + NEW.usage_complete - OLD.usage_complete
  WHERE user_id=NEW.user_id AND day=date(NEW.created_at,'+9 hours');
END;
