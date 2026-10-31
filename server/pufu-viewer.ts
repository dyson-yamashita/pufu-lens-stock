import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import html from 'virtual:pufu-viewer-html';
import { pufuViewerUri, pufuViewerMessages } from '../shared/pufu-viewer';
import { translate, type Language } from '../shared/locale';
import type { Env } from './env';

export function registerPufuViewer(server: McpServer, env: Env, language: Language = 'ja') {
  const origin = new URL(env.APP_URL).origin;
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const localizedHtml = Object.entries(pufuViewerMessages).reduce(
    (template, [key, slot]) =>
      template.replaceAll(`__PUFU_${key}__`, escape(translate(language, slot.message))),
    html
      .replaceAll('__PUFU_IMAGE_ORIGIN__', escape(origin))
      .replaceAll('__PUFU_LANGUAGE__', language),
  );
  const metadata = {
    ui: { csp: { resourceDomains: [origin], connectDomains: [] }, prefersBorder: true },
  };
  registerAppResource(
    server,
    'プ譜ビューアー',
    pufuViewerUri,
    { title: translate(language, 'プ譜ビューアー'), _meta: metadata },
    async () => ({
      contents: [
        {
          uri: pufuViewerUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: localizedHtml,
          _meta: metadata,
        },
      ],
    }),
  );
}
