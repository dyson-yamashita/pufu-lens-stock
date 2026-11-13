-- No backfill: historical feedback retains NULL context.
ALTER TABLE usability_feedback ADD COLUMN page_path TEXT;
ALTER TABLE usability_feedback ADD COLUMN device_type TEXT;
ALTER TABLE usability_feedback ADD COLUMN country TEXT;
ALTER TABLE usability_feedback ADD COLUMN viewport TEXT;
