import { mcpJa } from './mcp-ja';
import { generationJa } from './generation-ja';

export const ja: Record<string, string> = { ...generationJa, ...mcpJa };
