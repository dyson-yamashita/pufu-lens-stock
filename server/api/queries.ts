import { stockRelationsColumn } from '../features/relations/relations';

export const questionColumns =
  "q.id, q.stock_id, q.source, q.is_favorite, q.text, q.status, q.error, q.model, q.created_at, q.updated_at, q.project_id, p.name AS project_name, COALESCE(s.title, a.title) AS article_title, a.status AS article_status, a.domain, EXISTS (SELECT 1 FROM pufu_scores pf WHERE EXISTS (SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pf.id AND pq.question_id=q.id) AND pf.user_id = p.user_id AND pf.status = 'ready') AS has_pufu" +
  ',' +
  stockRelationsColumn('q');

export const questionJoins =
  'questions q JOIN projects p ON p.id = q.project_id LEFT JOIN stocks s ON s.id = q.stock_id LEFT JOIN articles a ON a.id = s.article_id';

export const pufuColumns =
  'id,is_favorite,title,question_id,project_id,task,status,error,model,editor_version,revision,current_phase,generation,created_at,updated_at';
