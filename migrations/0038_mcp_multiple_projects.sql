ALTER TABLE mcp_connection_settings ADD COLUMN project_ids TEXT;
UPDATE mcp_connection_settings SET project_ids=json_array(project_id) WHERE project_id IS NOT NULL;
