import { generationInput } from './pufu-grounding';

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
      paragraphs: sentences.filter((text) => text.trim()),
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
      groups.push(label(paragraphs.slice(i, i + groupSize).join('')));
    return {
      ...source,
      text: [start && `[partial]\n${start}`, ...groups, end && `[partial]\n${end}`]
        .filter(Boolean)
        .join('\n'),
    };
  });
  return { input: labeled, sources };
}
