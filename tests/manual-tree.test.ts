import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { expect, it } from 'vitest';
import UserManual, { getManualTree } from '../src/UserManual';
import { translateUi } from '../src/i18n';
import type { ManualNode } from '../src/manual-search';
it.each(['ja', 'en'] as const)(
  'indexes only actual %s manual text with working heading/paragraph links',
  (language) => {
    const tree = getManualTree(language);
    const { document } = parseHTML(renderToStaticMarkup(createElement(UserManual, { language })));
    const ids = new Set<string>();
    let leaves = 0;
    const check = (nodes: ManualNode[], depth: number) => {
      expect(nodes.length).toBeLessThanOrEqual(40);
      expect(depth).toBeLessThanOrEqual(5);
      for (const node of nodes) {
        expect(ids.has(node.id)).toBe(false);
        ids.add(node.id);
        const element = document.getElementById(node.href.split('#')[1]);
        expect(element).not.toBeNull();
        if (node.text) {
          leaves++;
          expect(element!.textContent!.replace(/\s+/g, '')).toContain(
            node.text.replace(/\s+/g, ''),
          );
        }
        check(node.children, depth + 1);
      }
    };
    check(tree, 0);
    expect(leaves).toBeGreaterThan(50);
    const text = JSON.stringify(tree);
    expect(text).not.toContain('manual.language_heading');
    for (const key of ['manual.language.future', 'manual.theme', 'manual.usage'])
      expect(text).toContain(translateUi(language, key));
  },
);
