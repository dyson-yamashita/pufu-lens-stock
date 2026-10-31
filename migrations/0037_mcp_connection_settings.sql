-- Keep deleted project IDs so a restricted connection fails closed.
CREATE TABLE mcp_connection_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  project_id TEXT,
  scopes TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  PRIMARY KEY (user_id, grant_id)
);
