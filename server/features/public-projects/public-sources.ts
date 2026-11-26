// These predicates are shared by the public endpoints and footprint analysis.
export const publicQuestionWhere = "(q.status='ready' OR (q.source='ai' AND q.text IS NOT NULL))";
export const publicPufuWhere = `pf.user_id=p.user_id AND pf.status='ready'
  AND EXISTS(SELECT 1 FROM pufu_questions pq JOIN questions q ON q.id=pq.question_id
    WHERE pq.pufu_id=pf.id AND ${publicQuestionWhere})
  AND COALESCE((SELECT ph.score_json FROM pufu_phases ph WHERE ph.pufu_id=pf.id AND ph.number=pf.current_phase),pf.score_json) IS NOT NULL`;
