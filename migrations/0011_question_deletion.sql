ALTER TABLE stocks ADD COLUMN ai_question_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (ai_question_dismissed IN (0, 1));
