import { applicationError, t, useLanguage } from './i18n';
import { useState } from 'react';
import { LoaderCircle, Star } from 'lucide-react';
import type { PufuSummary } from '../shared/pufu';
import { send } from './api';
type Favorite = Pick<PufuSummary, 'id' | 'is_favorite'>;
export default function PufuFavoriteButton({
  pufu,
  onSaved,
  onError,
  onBusyChange,
}: {
  pufu: Favorite;
  onSaved: (saved: Favorite) => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  useLanguage();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="pufu-favorite"
      aria-label={
        pufu.is_favorite ? t('ui.app.remove_from_favorites') : t('ui.app.add_to_favorites')
      }
      aria-pressed={Boolean(pufu.is_favorite)}
      aria-busy={busy}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        onBusyChange(true);
        onError('');
        try {
          const saved = await send<Favorite>(
            `/api/v1/pufus/${encodeURIComponent(pufu.id)}/favorite`,
            { is_favorite: !pufu.is_favorite },
            'PATCH',
          );
          onSaved(saved);
        } catch (error) {
          onError(applicationError((error as Error).message));
        } finally {
          onBusyChange(false);
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
      ) : (
        <Star size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}
