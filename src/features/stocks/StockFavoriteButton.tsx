import { LoaderCircle, Star } from 'lucide-react';
import type { Stock } from '../../../shared/domain';
import { t, useLanguage } from '../../i18n/i18n';

export function StockFavoriteButton({
  stock,
  busy,
  onClick,
  showLabel = false,
}: {
  stock: Stock;
  busy: boolean;
  onClick: () => void;
  showLabel?: boolean;
}) {
  useLanguage();
  return (
    <button
      type="button"
      className="stock-favorite"
      aria-label={
        stock.is_favorite ? t('ui.app.remove_from_favorites') : t('ui.app.add_to_favorites')
      }
      aria-pressed={Boolean(stock.is_favorite)}
      aria-busy={busy}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? (
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
      ) : (
        <Star size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
      {showLabel && <span>{t('ui.app.favorites')}</span>}
    </button>
  );
}
