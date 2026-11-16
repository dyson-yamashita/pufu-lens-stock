import { type CallToolResult } from '@modelcontextprotocol/server';

export const result = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

export class ToolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt?: string,
  ) {
    super(message);
  }
}
