import { api } from './api';
import { stockImageMaxBytes, stockImageTypes, type StockImage } from '../shared/stock-images';
import { t } from './i18n';

export function stockImageFileError(file: File): string {
  if (file.size > stockImageMaxBytes) return t('stock_images.too_large');
  if (!stockImageTypes.some((type) => type === file.type)) return t('stock_images.invalid_type');
  return '';
}
export function uploadStockImage(stockId: string, file: File, requestId: string) {
  return api<{ image: StockImage }>(`/api/v1/stocks/${encodeURIComponent(stockId)}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-File-Name': encodeURIComponent(file.name),
      'Idempotency-Key': requestId,
    },
    body: file,
  });
}
