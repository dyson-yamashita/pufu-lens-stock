-- Sitemap range reads for public stock detail URLs (same rowid pattern as questions/pufus).
CREATE INDEX public_search_stocks_project ON stocks(project_id);
