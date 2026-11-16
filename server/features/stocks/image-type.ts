import type { StockImage } from '../../../shared/stock-images';

export function imageType(bytes: Uint8Array): StockImage['content_type'] | null {
  const starts = (signature: number[]) => signature.every((value, i) => bytes[i] === value);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
