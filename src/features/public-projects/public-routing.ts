import { publicHref, publicPathPattern } from '../../../shared/public-route';

export function publicLink(hash: string) {
  const route = publicPathPattern.exec(window.location.pathname ?? '');
  return route ? publicHref(`/p/${route[1]}`, hash) : hash;
}

export function initialPublicPage() {
  const value = Number(new URLSearchParams(window.location.search ?? '').get('page'));
  return Number.isInteger(value) && value >= 1 && value <= 5000 ? value : 1;
}
