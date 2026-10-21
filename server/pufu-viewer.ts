import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import html from 'virtual:pufu-viewer-html';
import { pufuViewerUri } from '../shared/pufu-viewer';
import type { Env } from './env';

export function registerPufuViewer(server: McpServer, env: Env) {
  const origin = new URL(env.APP_URL).origin;
  const metadata = {
    ui: { csp: { resourceDomains: [origin], connectDomains: [] }, prefersBorder: true },
  };
  registerAppResource(server, 'プ譜ビューアー', pufuViewerUri, { _meta: metadata }, async () => ({
    contents: [
      {
        uri: pufuViewerUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: html.replaceAll('__PUFU_IMAGE_ORIGIN__', origin),
        _meta: metadata,
      },
    ],
  }));
}
