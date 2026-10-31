import { defaultPufuImageLabels, type PufuImageLabels } from '@pufu-lens/pufu-image';
import { translate, type Language } from './locale';

// Renderer configuration belongs to presentation; saved ProjectScoreModel data is unchanged.
export function pufuImageLabels(language: Language): PufuImageLabels {
  const t = (message: string) => translate(language, message);
  return {
    ...Object.fromEntries(
      Object.entries(defaultPufuImageLabels)
        .filter(([key]) => key !== 'elements')
        .map(([key, message]) => [key, t(message as string)]),
    ),
    elements: Object.fromEntries(
      Object.entries(defaultPufuImageLabels.elements).map(([key, message]) => [key, t(message)]),
    ),
  } as PufuImageLabels;
}
