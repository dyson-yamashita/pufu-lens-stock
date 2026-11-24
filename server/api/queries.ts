import {
  reflectionQuestionIdPrefix,
  visibleReflection,
} from '../features/questions/reflection-repository';
import { stockRelationsJson } from '../features/relations/relations';

const questionRecordFields = [
  'id',
  'stock_id',
  'source',
  'is_favorite',
  'text',
  'status',
  'error',
  'model',
  'created_at',
  'updated_at',
  'project_id',
];
const questionFields = `${questionRecordFields.map((field) => `q.${field}`).join(', ')},
  p.name AS project_name, COALESCE(s.title,a.title) AS article_title, a.status AS article_status, a.domain`;
const hasRelatedPufu = `EXISTS (SELECT 1 FROM pufu_scores pf WHERE EXISTS
  (SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pf.id AND pq.question_id=q.id)
  AND pf.user_id=p.user_id AND pf.status='ready')`;
export const questionColumns = `${questionFields},${hasRelatedPufu} AS has_pufu,${stockRelationsJson('q')} AS stocks_json`;

const questionJoinsTail = `JOIN projects p ON p.id=q.project_id
  LEFT JOIN stocks s ON s.id=q.stock_id LEFT JOIN articles a ON a.id=s.article_id`;
export const questionJoins = `questions q ${questionJoinsTail}`;

// 振り返りの本文は個人用テーブルに置き、本人のWeb一覧と詳細でだけ問いの形にする。
const reflectionQuestionRecords = `SELECT '${reflectionQuestionIdPrefix}'||r.id AS id,
  NULL AS stock_id,'ai' AS source,r.is_favorite,r.text,'ready' AS status,NULL AS error,NULL AS model,
  r.created_at,r.created_at AS updated_at,r.project_id,COALESCE(r.answer,'') AS note,
  r.id AS reflection_id,r.stock_ids AS reference_stock_ids,r.pufu_ids AS reference_pufu_ids,
  CASE WHEN r.status='queued' THEN r.generation-1 ELSE r.generation END AS reflection_generation
  FROM reflections r WHERE ${visibleReflection('r')}`;
export const reflectionQuestionJoins = `(${reflectionQuestionRecords}) q ${questionJoinsTail}`;
export const questionCardJoins = `(
  SELECT ${questionRecordFields.join(', ')},note,NULL AS reflection_id,
    NULL AS reference_stock_ids,NULL AS reference_pufu_ids,NULL AS reflection_generation FROM questions
  WHERE project_id IN (SELECT id FROM question_card_projects)
  UNION ALL ${reflectionQuestionRecords} AND r.project_id IN (SELECT id FROM question_card_projects)
) q ${questionJoinsTail}`;

export const reflectionCardStocks = `FROM json_each(q.reference_stock_ids) ref
  JOIN stocks rs ON rs.id=ref.value AND rs.project_id=p.id AND rs.user_id=p.user_id
  JOIN articles ra ON ra.id=rs.article_id AND ra.user_id=p.user_id`;
const reflectionStocksJson = `(SELECT json_group_array(json_object('id',id,'title',title)) FROM (
  SELECT rs.id,COALESCE(rs.title,ra.title) AS title ${reflectionCardStocks} ORDER BY ref.key
))`;
const hasReflectionPufu = `EXISTS (SELECT 1 FROM json_each(q.reference_pufu_ids) ref
  JOIN pufu_scores pf ON pf.id=ref.value AND pf.project_id=p.id AND pf.user_id=p.user_id
  WHERE pf.status='ready')`;
export const questionCardColumns = `${questionFields},(q.reflection_id IS NOT NULL) AS is_reflection,
  CASE WHEN q.reflection_id IS NULL THEN ${hasRelatedPufu} ELSE ${hasReflectionPufu} END AS has_pufu,
  CASE WHEN q.reflection_id IS NULL THEN ${stockRelationsJson('q')} ELSE ${reflectionStocksJson} END AS stocks_json`;

export const pufuColumns =
  'id,is_favorite,title,question_id,project_id,task,status,error,model,editor_version,revision,current_phase,generation,created_at,updated_at';
