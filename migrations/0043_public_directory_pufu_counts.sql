-- プ譜の公開件数に影響する変更でも、各拠点の一覧キャッシュを世代更新する。
CREATE TRIGGER public_directory_pufus_insert AFTER INSERT ON pufu_scores
WHEN EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufus_delete AFTER DELETE ON pufu_scores
WHEN EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufus_update
AFTER UPDATE OF project_id,user_id,status,score_json,current_phase ON pufu_scores
WHEN EXISTS (SELECT 1 FROM projects WHERE id IN (OLD.project_id,NEW.project_id) AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_questions_insert AFTER INSERT ON pufu_questions
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id=NEW.pufu_id AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_questions_delete AFTER DELETE ON pufu_questions
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id=OLD.pufu_id AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_questions_update AFTER UPDATE OF pufu_id,question_id ON pufu_questions
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id IN (OLD.pufu_id,NEW.pufu_id) AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_phases_insert AFTER INSERT ON pufu_phases
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id=NEW.pufu_id AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_phases_delete AFTER DELETE ON pufu_phases
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id=OLD.pufu_id AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_pufu_phases_update AFTER UPDATE OF pufu_id,number,score_json ON pufu_phases
WHEN EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id IN (OLD.pufu_id,NEW.pufu_id) AND p.is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
