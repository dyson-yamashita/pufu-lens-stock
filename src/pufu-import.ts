import { pufuScoreSchema, type PufuScore } from '../shared/pufu';
import { t } from './i18n';

export async function readPufuJson(file: Pick<File, 'size' | 'text'>): Promise<PufuScore> {
  if (file.size > 262144) throw new Error(t('pufu.import_too_large'));
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(t('pufu.import_read_failed'));
  }
  return parsePufuJson(text);
}

export function parsePufuJson(text: string): PufuScore {
  if (new TextEncoder().encode(text).byteLength > 262144)
    throw new Error(t('pufu.import_too_large'));
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(t('pufu.import_invalid_json'));
  }
  const result = pufuScoreSchema.safeParse(value);
  if (!result.success) throw new Error(t('pufu.import_invalid_score'));
  return result.data;
}
