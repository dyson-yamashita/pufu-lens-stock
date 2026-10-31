import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import ts from 'typescript';
import { en } from '../src/locales/en';
import { ja } from '../src/locales/ja';
import { errorKeys } from '../src/locales/error-keys';

it('all application message IDs and error mappings have matching Japanese/English interpolation contracts', async () => {
  const keys = new Set(Object.values(errorKeys));
  const files = (await readdir(new URL('../src/', import.meta.url))).filter((file) =>
    /\.tsx?$/.test(file),
  );
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['t', 'text'].includes(node.expression.text) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        keys.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const key of keys) {
    expect(Object.hasOwn(ja, key), `Japanese: ${key}`).toBe(true);
    expect(Object.hasOwn(en, key), `English: ${key}`).toBe(true);
    expect(en[key], key).not.toMatch(/[ぁ-んァ-ヶ一-龯]/);
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
    expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
  }
});
