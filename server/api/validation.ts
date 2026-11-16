import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../env';

export async function body<T>(c: import('hono').Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'JSON形式で送信してください。' });
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HTTPException(400, {
      message: '入力内容を確認してください。文字数または形式が正しくありません。',
    });
  return result.data;
}
