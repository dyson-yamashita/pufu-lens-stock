// 課題(task)は最新局面に追随するため、見出しの既定値は第1局面から取得する。
export function firstPhaseTaskColumn(table: string) {
  return `COALESCE((SELECT json_extract(first.score_json, '$.gainingGoal.text') FROM pufu_phases first WHERE first.pufu_id=${table}.id AND first.number=1), CASE WHEN ${table}.current_phase=1 THEN ${table}.task END, json_extract(${table}.input_json, '$.task'), ${table}.task) AS first_phase_task`;
}
