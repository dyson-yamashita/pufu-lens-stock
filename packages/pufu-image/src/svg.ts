import { pufuScoreSchema, type PufuScore } from './model.js';
import metrics from './font-metrics.json';
import { PufuImageError, imageLimits } from './errors.js';
export type PufuImageLabels = {
  title: string;
  description: string;
  descriptionWithoutProgress: string;
  eightElements: string;
  measures: string;
  purposes: string;
  winCondition: string;
  gainingGoal: string;
  progress: string;
  elements: Record<keyof PufuScore['elements'], string>;
};
export const defaultPufuImageLabels: PufuImageLabels = {
  title: 'プ譜',
  description:
    'ProjectScoreModelから生成。廟算八要素、施策、中間目的、勝利条件、獲得目標、保存されたコメントを表示。施策の進捗表示はあり。',
  descriptionWithoutProgress:
    'ProjectScoreModelから生成。廟算八要素、施策、中間目的、勝利条件、獲得目標、保存されたコメントを表示。施策の進捗表示はなし。',
  eightElements: '廟算八要素',
  measures: '施策',
  purposes: '中間目的',
  winCondition: '勝利条件',
  gainingGoal: '獲得目標',
  progress: '進捗',
  elements: {
    people: 'ひと',
    money: 'お金',
    time: '時間',
    quality: 'クオリティ',
    businessScheme: '商流 / 座組',
    environment: '環境',
    rival: 'ライバル',
    foreignEnemy: '外敵',
  },
};
export type SvgOptions = {
  showProgress?: boolean;
  theme?: 'light' | 'dark';
  labels?: PufuImageLabels;
  language?: string;
};
type BaseNode = PufuScore['gainingGoal'];
type MeasureNode = PufuScore['purposes'][number]['measures'][number];
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const palette = {
  white: { fill: '#ffffff', border: '#c8d2df', text: '#24354e' },
  blue: { fill: '#eaf3ff', border: '#70a8ed', text: '#234c80' },
  green: { fill: '#eef8f1', border: '#69ad83', text: '#2c6841' },
  red: { fill: '#fff0f1', border: '#d98d95', text: '#8a3d49' },
  yellow: { fill: '#fff9e4', border: '#d6b962', text: '#71602f' },
};
const darkColors: Record<string, string> = {
  '#ffffff': '#172033',
  '#24354e': '#e5eaf3',
  '#4b5563': '#e5eaf3',
  '#6b7280': '#afbdd2',
  '#c8d2df': '#667b98',
  '#9ca3af': '#667b98',
  '#bdc8d8': '#667b98',
  '#cbd5e1': '#667b98',
  '#a4b0c0': '#8297b3',
  '#eaf3ff': '#223653',
  '#70a8ed': '#7ba9e2',
  '#eef8f1': '#233d35',
  '#69ad83': '#7ebc9a',
  '#fff0f1': '#442b35',
  '#d98d95': '#da9cab',
  '#fff9e4': '#423923',
  '#d6b962': '#d2b96f',
  '#41b4f7': '#6ac3ff',
  '#43db6d': '#6ddb8b',
  '#f2a4b7': '#ffb2c6',
  '#73839a': '#afbdd2',
  '#e1e8f1': '#36445c',
  '#5384b7': '#a9c8f5',
  '#56718f': '#b3c9e7',
};
const xml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      (
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }) as Record<
          string,
          string
        >
      )[c]!,
  );
function textWidth(text: string, size: number, _bold = false): number {
  let units = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (/\p{Mark}/u.test(character) || point === 0x200d || point === 0xfe0f) continue;
    units += (metrics as Record<string, number>)[String(point)] ?? 1000;
  }
  return (units / 1000) * size;
}
function wrap(text: string, width: number, size: number, bold = false, language = 'ja') {
  if (language !== 'ja') {
    const words = new Intl.Segmenter(language, { granularity: 'word' });
    const lines: string[] = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const { segment } of words.segment(paragraph)) {
        const pieces =
          textWidth(segment, size, bold) <= width
            ? [segment]
            : [...segmenter.segment(segment)].map((item) => item.segment);
        for (const piece of pieces) {
          if (textWidth(piece, size, bold) > width)
            throw new PufuImageError('TEXT_TOO_WIDE', '分割できない文字列が表示幅を超えています。');
          if (line && textWidth(line + piece, size, bold) > width) {
            lines.push(line);
            line = piece;
          } else line += piece;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  const lines = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      if (textWidth(segment, size, bold) > width)
        throw new PufuImageError('TEXT_TOO_WIDE', '分割できない文字列が表示幅を超えています。');
      if (line && textWidth(line + segment, size, bold) > width) {
        const pieces = [...segmenter.segment(line)].map((item) => item.segment);
        let cut = pieces.length;
        if (/^[、。，．！？）］」』】]/.test(segment)) {
          cut--;
          while (cut > 0 && /^[、。，．！？）］」』】]/.test(pieces[cut])) cut--;
        } else if (/[（［「『【]$/.test(line)) cut--;
        const carried = pieces.slice(cut).join('') + segment;
        if (cut > 0 && cut < pieces.length && textWidth(carried, size, bold) <= width) {
          lines.push(pieces.slice(0, cut).join(''));
          line = carried;
        } else {
          lines.push(line);
          line = segment;
        }
      } else line += segment;
    }
    lines.push(line);
  }
  return lines;
}
function textBlock(
  text: string,
  x: number,
  y: number,
  width: number,
  size = 22,
  color = '#24354e',
  bold = false,
  centered = false,
  language = 'ja',
) {
  const lines = wrap(text, width, size, bold, language);
  const lineHeight = Math.round(size * 1.65);
  const content = lines
    .map(
      (line, index) =>
        `<text xml:space="preserve" x="${x}" y="${y + index * lineHeight}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${color}"${centered ? ' text-anchor="middle"' : ''}>${xml(line)}</text>`,
    )
    .join('');
  return { content, height: lines.length * lineHeight, lines };
}
function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = 'none',
  radius = 12,
) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}
function comment(
  node: BaseNode,
  x: number,
  y: number,
  width: number,
  upside = false,
  language = 'ja',
) {
  if (!node.comment.text) return { content: '', height: 0 };
  const stroke = { blue: '#41b4f7', green: '#43db6d', red: '#f2a4b7' }[node.comment.color];
  const text = textBlock(
    node.comment.text,
    x + 15,
    y + 29,
    width - 30,
    19,
    '#4b5563',
    false,
    false,
    language,
  );
  const height = text.height + 23;
  const mid = x + width / 2;
  const top = upside ? '' : `H ${mid - 13} L ${mid} ${y - 13} L ${mid + 13} ${y}`;
  const bottom = upside
    ? `H ${mid + 13} L ${mid} ${y + height + 13} L ${mid - 13} ${y + height}`
    : '';
  const d = `M ${x + 6} ${y} ${top} H ${x + width - 6} Q ${x + width} ${y} ${x + width} ${y + 6} V ${y + height - 6} Q ${x + width} ${y + height} ${x + width - 6} ${y + height} ${bottom} H ${x + 6} Q ${x} ${y + height} ${x} ${y + height - 6} V ${y + 6} Q ${x} ${y} ${x + 6} ${y} Z`;
  return {
    content: `<g data-comment-of="${xml(node.uuid)}" data-color="${node.comment.color}"><path d="${d}" fill="#ffffff" stroke="${stroke}" stroke-width="2"/>${text.content}</g>`,
    height,
  };
}
function measure(
  node: MeasureNode,
  x: number,
  y: number,
  width: number,
  showProgress: boolean,
  labels: PufuImageLabels,
  language: string,
) {
  const color = palette[node.color];
  const text = textBlock(
    node.text,
    x + 17,
    y + 33,
    width - 34,
    22,
    '#4b5563',
    false,
    false,
    language,
  );
  const hasProgress = showProgress && node.progress !== undefined;
  const height = text.height + 23 + (hasProgress ? 35 : 0);
  let content = rect(x, y, width, height, color.fill, color.border, 5) + text.content;
  if (hasProgress && node.progress !== undefined) {
    const progressY = y + height - 22;
    content += '<g data-role="measure-progress">';
    content += `<text x="${x + 22}" y="${progressY + 4}" font-size="15" fill="#73839a">${xml(labels.progress)}</text>`;
    const barX = Math.max(66, 32 + textWidth(labels.progress, 15));
    const barWidth = width - barX - 84;
    content += rect(x + barX, progressY - 6, barWidth, 8, '#e1e8f1', 'none', 4);
    if (node.progress > 0)
      content += rect(
        x + barX,
        progressY - 6,
        (barWidth * node.progress) / 100,
        8,
        '#5384b7',
        'none',
        4,
      );
    content += `<text x="${x + width - 20}" y="${progressY + 4}" text-anchor="end" font-size="16" fill="#56718f">${node.progress}%</text>`;
    content += '</g>';
  }
  const note = comment(node, x, y + height + 25, width, false, language);
  return {
    content: `<g data-role="measure" data-uuid="${xml(node.uuid)}">${content}${note.content}</g>`,
    height: height + (note.height ? note.height + 25 : 0),
    centerY: y + height / 2,
  };
}
function objective(
  node: BaseNode,
  label: string,
  x: number,
  y: number,
  width: number,
  above = false,
  language = 'ja',
) {
  const pre = above ? comment(node, x, y, width, true, language) : { content: '', height: 0 };
  const boxY = y + (pre.height ? pre.height + 26 : 0);
  const text = textBlock(
    node.text,
    x + 17,
    boxY + 66,
    width - 34,
    23,
    '#4b5563',
    false,
    false,
    language,
  );
  const height = Math.max(170, text.height + 65);
  let content = pre.content + rect(x, boxY, width, height, '#ffffff', '#9ca3af', 5);
  content += `<text x="${x + 17}" y="${boxY + 28}" font-size="17" fill="#6b7280">${xml(label)}</text>`;
  content += text.content;
  const note = above
    ? { content: '', height: 0 }
    : comment(node, x, boxY + height + 25, width, false, language);
  return {
    content: `<g data-role="objective" data-uuid="${xml(node.uuid)}">${content}${note.content}</g>`,
    height: boxY - y + height + (note.height ? note.height + 25 : 0),
    centerY: boxY + height / 2,
  };
}

function purposeHeight(text: ReturnType<typeof textBlock>, width: number, size: number) {
  const radiusX = width / 2;
  const lineHeight = Math.round(size * 1.65);
  let radiusY = 75;
  for (const [index, line] of text.lines.entries()) {
    const halfLineWidth = textWidth(line, size) / 2 + 10;
    const baseline = -text.height / 2 + 26 + index * lineHeight;
    const verticalExtent = Math.max(Math.abs(baseline - size), Math.abs(baseline + size * 0.3)) + 8;
    const horizontalRatio = Math.min(0.97, halfLineWidth / radiusX);
    radiusY = Math.max(radiusY, verticalExtent / Math.sqrt(1 - horizontalRatio ** 2));
  }
  return Math.ceil(radiusY * 2);
}

function validateScore(input: unknown) {
  let parsed;
  try {
    // Zodが配列全体を走査する前に件数を確認し、巨大な不正配列の処理を避ける。
    const object = input as { purposes?: { measures?: unknown[] }[] } | null | undefined;
    if (Array.isArray(object?.purposes)) {
      if (object.purposes.length > 12)
        throw new PufuImageError('INVALID_INPUT', '中間目的は12件以内で指定してください。');
      for (const purpose of object.purposes)
        if (Array.isArray(purpose?.measures) && purpose.measures.length > 12)
          throw new PufuImageError(
            'INVALID_INPUT',
            '施策は中間目的ごとに12件以内で指定してください。',
          );
    }
    parsed = pufuScoreSchema.safeParse(input);
  } catch (cause) {
    if (cause instanceof PufuImageError) throw cause;
    throw new PufuImageError('INVALID_INPUT', 'プ譜の入力形式が不正です。', { cause });
  }
  if (!parsed.success)
    throw new PufuImageError('INVALID_INPUT', 'プ譜の入力形式が不正です。', {
      cause: parsed.error,
    });
  const score = parsed.data;
  const nodes = [
    score.gainingGoal,
    score.winCondition,
    ...Object.values(score.elements),
    ...score.purposes.flatMap((p) => [p, ...p.measures]),
  ];
  const texts = nodes.flatMap((node) => [node.text, node.comment.text]);
  if (texts.reduce((n, text) => n + text.length, 0) > imageLimits.maxTextCharacters)
    throw new PufuImageError('INPUT_TOO_LARGE', '文章量が画像生成の上限を超えています。');
  for (const text of texts)
    for (const character of text) {
      const code = character.codePointAt(0)!;
      if (
        (code < 32 && ![9, 10, 13].includes(code)) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      )
        throw new PufuImageError('INVALID_TEXT', '画像に使用できない制御文字が含まれています。');
    }
  return score;
}

export function createPufuSvg(input: unknown, options: SvgOptions = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    (options.showProgress !== undefined && typeof options.showProgress !== 'boolean')
  )
    throw new PufuImageError('INVALID_OPTIONS', '進捗表示には真偽値を指定してください。');
  if (options.theme !== undefined && options.theme !== 'light' && options.theme !== 'dark')
    throw new PufuImageError('INVALID_OPTIONS', 'テーマはlightまたはdarkを指定してください。');
  const {
    showProgress = true,
    theme = 'light',
    labels = defaultPufuImageLabels,
    language = 'ja',
  } = options;
  if (typeof language !== 'string' || !language)
    throw new PufuImageError('INVALID_OPTIONS', '言語には有効な言語コードを指定してください。');
  try {
    new Intl.Segmenter(language);
  } catch (cause) {
    throw new PufuImageError('INVALID_OPTIONS', '言語には有効な言語コードを指定してください。', {
      cause,
    });
  }
  if (
    !labels ||
    typeof labels !== 'object' ||
    Object.keys(defaultPufuImageLabels).some((key) =>
      key === 'elements'
        ? !labels.elements ||
          Object.keys(defaultPufuImageLabels.elements).some(
            (element) =>
              typeof labels.elements[element as keyof typeof labels.elements] !== 'string',
          )
        : typeof labels[key as Exclude<keyof PufuImageLabels, 'elements'>] !== 'string',
    )
  )
    throw new PufuImageError('INVALID_OPTIONS', '画像のラベルをすべて指定してください。');
  const score = validateScore(input);
  const width = 1760;
  const rowStart = 88;
  const xElements = 48,
    elementsWidth = 330;
  const xMeasure = 446,
    measureWidth = 360;
  const xPurpose = 910,
    purposeWidth = 280;
  const xObjective = 1290,
    objectiveWidth = 384;
  let content = '';
  let elementY = rowStart;
  for (const [key, label] of Object.keys(defaultPufuImageLabels.elements).map((key) => [
    key,
    labels.elements[key as keyof typeof labels.elements],
  ]) as [keyof typeof score.elements, string][]) {
    const node = score.elements[key];
    const text = node.text
      ? textBlock(
          node.text,
          xElements + 8,
          elementY + 53,
          elementsWidth - 16,
          21,
          '#4b5563',
          false,
          false,
          language,
        )
      : { content: '', height: 0 };
    content += `<g data-role="element" data-uuid="${xml(node.uuid)}"><text x="${xElements + 8}" y="${elementY + 20}" font-size="17" fill="#6b7280">${xml(label)}</text>${text.content}</g>`;
    const end = elementY + 25 + text.height;
    const note = comment(node, xElements + 2, end + 24, elementsWidth - 4, false, language);
    content += note.content;
    elementY = end + (note.height ? note.height + 46 : 22);
  }
  const groups = [];
  let purposeY = rowStart;
  for (const purpose of score.purposes) {
    let measureY = purposeY;
    const measures = [];
    for (const node of purpose.measures) {
      const item = measure(node, xMeasure, measureY, measureWidth, showProgress, labels, language);
      measures.push(item);
      measureY += item.height + 26;
    }
    const purposeText = textBlock(
      purpose.text,
      xPurpose + purposeWidth / 2,
      0,
      purposeWidth - 58,
      23,
      '#24354e',
      false,
      true,
      language,
    );
    const ellipseHeight = purposeHeight(purposeText, purposeWidth, 23);
    const groupHeight = Math.max(ellipseHeight, measureY - purposeY - 26, 250);
    const centerY = purposeY + groupHeight / 2;
    const note = comment(
      purpose,
      xPurpose,
      centerY + ellipseHeight / 2 + 24,
      purposeWidth,
      false,
      language,
    );
    groups.push({
      purpose,
      purposeY,
      groupHeight,
      measures,
      centerY,
      ellipseHeight,
      text: purposeText,
      note,
    });
    purposeY += groupHeight + note.height + 54;
  }
  const win = objective(
    score.winCondition,
    labels.winCondition,
    xObjective,
    rowStart + 8,
    objectiveWidth,
    false,
    language,
  );
  const goalSize = objective(
    score.gainingGoal,
    labels.gainingGoal,
    xObjective,
    0,
    objectiveWidth,
    true,
    language,
  ).height;
  const minBodyBottom = Math.max(
    elementY + 12,
    purposeY + 50,
    rowStart + win.height + goalSize + 135,
  );
  const goal = objective(
    score.gainingGoal,
    labels.gainingGoal,
    xObjective,
    minBodyBottom - goalSize - 14,
    objectiveWidth,
    true,
    language,
  );
  const height = minBodyBottom + 49;
  if (!Number.isSafeInteger(height) || height < 1 || width * height > imageLimits.maxPixels)
    throw new PufuImageError(
      'IMAGE_TOO_LARGE',
      '画像が大きすぎます。文章量や施策数を減らしてください。',
    );
  let lines = '';
  for (const group of groups) {
    const shift =
      group.purposeY +
      (group.groupHeight - (group.measures.reduce((n, m) => n + m.height + 26, 0) - 26)) / 2 -
      group.purposeY;
    for (const item of group.measures) {
      content += `<g transform="translate(0 ${shift})">${item.content}</g>`;
      lines += `<path d="M ${xMeasure + measureWidth} ${item.centerY + shift} L ${xPurpose} ${group.centerY}" fill="none" stroke="#a4b0c0" stroke-width="1.7"/>`;
    }
    lines += `<path d="M ${xPurpose + purposeWidth} ${group.centerY} L ${xObjective} ${win.centerY}" fill="none" stroke="#a4b0c0" stroke-width="1.7"/>`;
    content += `<g data-role="purpose" data-uuid="${xml(group.purpose.uuid)}"><ellipse cx="${xPurpose + purposeWidth / 2}" cy="${group.centerY}" rx="${purposeWidth / 2}" ry="${group.ellipseHeight / 2}" fill="#ffffff" stroke="#a4b0c0" stroke-width="1.5"/>`;
    const purposeText = textBlock(
      group.purpose.text,
      xPurpose + purposeWidth / 2,
      group.centerY - group.text.height / 2 + 26,
      purposeWidth - 58,
      23,
      '#24354e',
      false,
      true,
      language,
    );
    content += purposeText.content + group.note.content + '</g>';
  }
  const heads = [
    [xElements + 8, labels.eightElements, 'start'],
    [xMeasure + measureWidth / 2, labels.measures, 'middle'],
    [xPurpose + purposeWidth / 2, labels.purposes, 'middle'],
    [xObjective, labels.winCondition, 'start'],
  ]
    .map(
      ([x, label, anchor]) =>
        `<text x="${x}" y="57" text-anchor="${anchor}" font-size="18" font-weight="700" fill="#6b7280">${xml(label)}</text>`,
    )
    .join('');
  const description = showProgress ? labels.description : labels.descriptionWithoutProgress;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xml(labels.title)}：${xml(score.gainingGoal.text)}</title><desc>${xml(description)}</desc><g font-family="Noto Sans CJK JP, sans-serif">${rect(0, 0, width, height, '#ffffff', 'none', 0)}${rect(30, 24, 1696, height - 48, '#ffffff', '#bdc8d8', 0)}${heads}<line x1="402" y1="24" x2="402" y2="${height - 24}" stroke="#cbd5e1"/>${lines}${content}${win.content}${goal.content}</g></svg>`;
  if (theme === 'light') return svg;
  // 色属性だけを置き換え、本文に書かれた色コードやエスケープ済みの文章は変えない。
  return svg.replace(
    /\b(fill|stroke)="(#[0-9a-f]{6})"/g,
    (_match, attribute: string, color: string) => `${attribute}="${darkColors[color] ?? color}"`,
  );
}
