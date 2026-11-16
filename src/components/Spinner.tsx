import { LoaderCircle } from 'lucide-react';
import { useLanguage } from '../i18n/i18n';

export function Spinner() {
  useLanguage();
  return <LoaderCircle className="spin" size={17} aria-hidden="true" />;
}
