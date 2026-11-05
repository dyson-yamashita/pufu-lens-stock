import { z } from 'zod';
import { elementKeys } from '../shared/pufu';
import { generationInput, pufuDraftSchema } from './pufu-grounding';
import type { Language } from '../shared/locale';

const evidence = z.string().trim().max(240);
const condition = z.strictObject({ evidence, text: z.string().trim().max(240) });
export const pufuEvidenceDraftSchema = pufuDraftSchema.extend({
  elements: z.strictObject(
    Object.fromEntries(elementKeys.map((key) => [key, condition])) as Record<
      (typeof elementKeys)[number],
      typeof condition
    >,
  ),
  purposes: z
    .array(
      z.strictObject({
        text: pufuDraftSchema.shape.winCondition,
        measures: z
          .array(
            z.strictObject({
              evidence: evidence.min(1),
              ...pufuDraftSchema.shape.purposes.element.shape.measures.element.shape,
            }),
          )
          .max(3),
      }),
    )
    .max(4),
});

export const evidenceInstructions = (language: Language) =>
  language === 'en'
    ? `\nInternal verification format overrides the earlier field shapes: each measure is {"evidence":"E12","text":"short supported action","color":"white"}; each element is {"evidence":"E12","text":"short supported condition"}. First select ONE source unit marked [E0], [E1], etc. in the input, then use only that unit's facts for text, preserving subjects, conditions and negation. evidence is its ID without brackets, not a quote. Do not mix different units' fallback conditions. Unknown conditions use {"evidence":"","text":""}. A role or deadline is still a condition, not an action. Units marked [partial] cannot be evidence. Source IDs are temporary verification data and are discarded; never put them, quotes or source notes in displayed text/comments. Other fields keep their previous shapes.`
    : `\n内部検証用の形式を優先します。各施策は{"evidence":"E12","text":"根拠を短く言い換えた施策","color":"white"}、八要素の各項目は{"evidence":"E12","text":"根拠を短く言い換えた条件"}にします。先に入力中の[E0]、[E1]等の区間を一つ選び、その区間の事実だけで対象・条件・否定を保ってtextを書きます。evidenceは括弧なしのIDで、原文の転記ではありません。別区間の代替手段や条件を混ぜません。不明な条件は{"evidence":"","text":""}。担当の権限や期限は根拠があっても施策にしません。[partial]の切断部分は根拠にできません。IDは検証後に破棄する内部データです。表示本文やコメントにID・引用・参考注記を転記しません。他の項目の形式は前述のままです。`;

// 本文を落とさず、資料の区間に一時的なIDを付ける。ラベル追加は最大約1KiB。
export function prepareEvidenceInput(
  input: ReturnType<typeof generationInput>,
  projectComplete = true,
) {
  const labeled = structuredClone(input);
  const sources = new Map<string, string>();
  const label = (text: string) => {
    if (!text.trim()) return text;
    const id = `E${sources.size}`;
    sources.set(id, text);
    return `[${id}]\n${text}`;
  };
  labeled.task = label(labeled.task);
  labeled.details = label(labeled.details);
  labeled.project.description = projectComplete
    ? label(labeled.project.description)
    : `[partial]\n${labeled.project.description}`;
  if (labeled.question) labeled.question.text = label(labeled.question.text);
  const parts = labeled.sources.map((source) => {
    if (source.kind === 'summary') return { start: undefined, end: undefined, paragraphs: [] };
    const sentences = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(source.text),
      (part) => part.segment,
    );
    const start = source.clippedStart ? sentences.shift() : undefined;
    const end = source.clippedEnd ? sentences.pop() : undefined;
    return {
      start,
      end,
      paragraphs: sentences
        .join('')
        .split(/\n+/)
        .map((text) => text.trim())
        .filter(Boolean),
    };
  });
  const paragraphs = parts.map((part) => part.paragraphs);
  const groupSize = Math.max(
    1,
    Math.ceil(paragraphs.reduce((n, parts) => n + parts.length, 0) / 80),
  );
  labeled.sources = labeled.sources.map((source, index) => {
    if (source.kind === 'summary') return { ...source, text: `[background]\n${source.text}` };
    const paragraphs = parts[index].paragraphs;
    const { start, end } = parts[index];
    const groups: string[] = [];
    for (let i = 0; i < paragraphs.length; i += groupSize)
      groups.push(label(paragraphs.slice(i, i + groupSize).join('\n')));
    return {
      ...source,
      text: [start && `[partial]\n${start}`, ...groups, end && `[partial]\n${end}`]
        .filter(Boolean)
        .join('\n'),
    };
  });
  return { input: labeled, sources };
}

// 根拠区間のIDは照合だけに使い、保存するProjectScoreModelには残さない。
export function stripDraftEvidence(value: unknown, sources: ReadonlyMap<string, string>) {
  const draft = pufuEvidenceDraftSchema.loose().parse(value);
  const verify = (node: z.infer<typeof condition>) => {
    if (!node.text && !node.evidence) return '';
    if (!node.text || !node.evidence || !sources.has(node.evidence))
      throw new Error('生成文の根拠を確認できません。再試行してください。');
    return node.text;
  };
  return {
    ...draft,
    purposes: draft.purposes.map((purpose) => ({
      text: purpose.text,
      measures: purpose.measures.map((measure) => ({
        text: verify(measure),
        color: measure.color,
      })),
    })),
    elements: Object.fromEntries(elementKeys.map((key) => [key, verify(draft.elements[key])])),
  };
}
