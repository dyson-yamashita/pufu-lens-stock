CREATE TABLE public_directory_revision (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision TEXT NOT NULL
);
-- statement-breakpoint
INSERT INTO public_directory_revision (id,revision) VALUES (1,lower(hex(randomblob(16))));
-- statement-breakpoint
CREATE TRIGGER public_directory_projects_insert AFTER INSERT ON projects
WHEN NEW.is_public=1
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_projects_delete AFTER DELETE ON projects
WHEN OLD.is_public=1
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_projects_update
AFTER UPDATE OF is_public,public_id,name,public_description,published_at ON projects
WHEN OLD.is_public=1 OR NEW.is_public=1
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_stocks_insert AFTER INSERT ON stocks
WHEN EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_stocks_delete AFTER DELETE ON stocks
WHEN EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_stocks_update AFTER UPDATE OF project_id ON stocks
WHEN EXISTS (SELECT 1 FROM projects WHERE id IN (OLD.project_id,NEW.project_id) AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_questions_insert AFTER INSERT ON questions
WHEN EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_questions_delete AFTER DELETE ON questions
WHEN EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
-- statement-breakpoint
CREATE TRIGGER public_directory_questions_update
AFTER UPDATE OF project_id,status,source,text ON questions
WHEN EXISTS (SELECT 1 FROM projects WHERE id IN (OLD.project_id,NEW.project_id) AND is_public=1)
BEGIN UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1; END;
