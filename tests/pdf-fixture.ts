// 外部資料に依存せず、実際のPDFパーサーを通すための小さなPDF。
export function pdfFixture(pages: string[], title?: string): Uint8Array<ArrayBuffer> {
  const hex = (value: string) =>
    Array.from({ length: value.length }, (_, i) =>
      value.charCodeAt(i).toString(16).padStart(4, '0'),
    ).join('');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< ${title ? `/Title <FEFF${hex(title)}>` : ''} >>`,
  ];
  for (const text of pages) {
    const lines = text.match(/.{1,72}(?:\s|$)/g) ?? [];
    const height = Math.max(792, lines.length * 14 + 100);
    const contentId = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = `BT /F1 12 Tf 50 ${height - 50} Td 14 TL ${lines.map((line) => `(${line.trim().replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ')} ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  return serializePdf(objects);
}

function serializePdf(objects: string[]): Uint8Array<ArrayBuffer> {
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export const pdfArticleText =
  'Saving an article and generating its summary are separate operations. '.repeat(5);

export const japanesePdfText = '公開された日本語の記事から本文を取得し、要約と問いを生成します。';
export function japanesePdfFixture(): Uint8Array<ArrayBuffer> {
  const hex = Array.from(japanesePdfText, (char) =>
    char.charCodeAt(0).toString(16).padStart(4, '0'),
  ).join('');
  const stream = `BT /F1 12 Tf 50 740 Td 18 TL ${Array.from({ length: 10 }, () => `<${hex}> Tj T*`).join(' ')} ET`;
  return serializePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [5 0 R] >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 0 >> /DW 1000 >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]);
}
