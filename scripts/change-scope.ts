// Only known documentation locations may bypass application validation.
// In particular, instructions, CI, formal models and source assets are not documentation.
export function isDocumentationPath(path: string): boolean {
  if (/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI|SKILL)\.md$/i.test(path)) return false;
  if (path === 'docs/FORMAL_VERIFICATION.md') return false;
  return /^(?:README\.md|docs\/.+\.md|packages\/[^/]+\/README\.md|public\/fonts\/README\.md|patches\/README\.md)$/.test(
    path,
  );
}

export function requiresApplicationValidation(paths: string[]): boolean {
  return paths.length === 0 || paths.some((path) => !isDocumentationPath(path));
}
