import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requiresApplicationValidation } from '../scripts/change-scope';

describe('変更内容によるアプリ検証の選択', () => {
  it('通常の文書だけならアプリ検証を要求しない', () => {
    expect(
      requiresApplicationValidation([
        'README.md',
        'docs/SPEC.md',
        'docs/superpowers/plans/example.md',
        'packages/e2e/README.md',
        'packages/pufu-image/README.md',
        'public/fonts/README.md',
        'patches/README.md',
      ]),
    ).toBe(false);
  });

  it.each([
    'AGENTS.md',
    'docs/AGENTS.md',
    'docs/nested/claude.md',
    'docs/GEMINI.md',
    'docs/SKILL.md',
    'docs/FORMAL_VERIFICATION.md',
    '.agents/skills/example/SKILL.md',
    'skills/support-pufu/SKILL.md',
    '.github/workflows/ci.yml',
    'formal/targets.json',
    'formal/Example/Main.lean',
    'src/content.md',
    'public/example.md',
    'packages/pufu-image/src/index.ts',
    'scripts/change-scope.ts',
    'package.json',
    'pnpm-lock.yaml',
    'unknown.md',
  ])('文書と %s が混在する場合もアプリ検証を残す', (path) => {
    expect(requiresApplicationValidation(['README.md', path])).toBe(true);
  });

  it('変更なし・判定対象なしは文書だけと断定しない', () => {
    expect(requiresApplicationValidation([])).toBe(true);
  });
});

describe('CIのGit差分判定', () => {
  it('分岐後の文書変更・実装削除を伴う改名・比較失敗を区別する', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pufu-change-scope-'));
    const output = join(directory, '.git', 'github-output');
    const script = fileURLToPath(new URL('../scripts/ci-changes.ts', import.meta.url));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
    const commit = (message: string) => {
      git('add', '.');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const classify = (base: string, head: string) => {
      writeFileSync(output, '');
      execFileSync(process.execPath, [script, base, head], {
        cwd: directory,
        env: { ...process.env, GITHUB_OUTPUT: output },
        stdio: 'pipe',
      });
      return readFileSync(output, 'utf8');
    };
    try {
      git('init', '-b', 'main');
      writeFileSync(join(directory, 'README.md'), 'base\n');
      mkdirSync(join(directory, 'src'));
      writeFileSync(join(directory, 'src/feature.ts'), 'export const value = 1;\n');
      const base = commit('base');
      git('switch', '-c', 'docs');
      writeFileSync(join(directory, 'README.md'), 'updated\n');
      const docs = commit('docs');
      expect(classify(base, docs)).toBe('application=false\n');
      expect(classify(base, base)).toBe('application=true\n');

      git('switch', 'main');
      writeFileSync(join(directory, 'src/feature.ts'), 'export const value = 2;\n');
      const advancedBase = commit('advance main');
      expect(classify(advancedBase, docs)).toBe('application=false\n');

      git('switch', 'docs');
      mkdirSync(join(directory, 'docs'));
      git('mv', 'src/feature.ts', 'docs/feature.md');
      const renamed = commit('move implementation into docs');
      expect(classify(base, renamed)).toBe('application=true\n');
      expect(() => classify('0'.repeat(40), docs)).toThrow();
      expect(readFileSync(output, 'utf8')).toBe('');
      expect(() => classify('--invalid', docs)).toThrow();
      expect(readFileSync(output, 'utf8')).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
