import { useLanguage } from '../i18n/i18n';

export function FormError({ error }: { error: string }) {
  useLanguage();
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
