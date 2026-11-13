// Enhance only links into the manual already rendered in this document.
// The original href remains the fallback for other pages and modified clicks.
export function revealManualSection(href: string): (() => void) | null {
  let destination: URL, current: URL, id: string;
  try {
    current = new URL(window.location.href);
    destination = new URL(href, current);
    id = decodeURIComponent(destination.hash.slice(1));
  } catch {
    return null;
  }
  const path = (value: string) => value.replace(/\/$/, '');
  if (
    !/^\/(?:en\/)?manual$/.test(path(current.pathname)) ||
    destination.origin !== current.origin ||
    path(destination.pathname) !== path(current.pathname) ||
    !/^manual-[a-z0-9-]+$/.test(id) ||
    id.length > 100
  )
    return null;
  const target = document.getElementById(id);
  if (!target?.closest('.manual-page .manual-main')) return null;
  let detail = target.closest('details');
  while (detail) {
    detail.setAttribute('open', '');
    detail = detail.parentElement?.closest('details') ?? null;
  }
  const hadHighlight = target.classList.contains('manual-target-highlight');
  const hadTabIndex = target.hasAttribute('tabindex');
  target.classList.add('manual-target-highlight');
  if (!hadTabIndex) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.clearTimeout(timer);
    if (!hadHighlight) target.classList.remove('manual-target-highlight');
    if (!hadTabIndex && target.getAttribute('tabindex') === '-1')
      target.removeAttribute('tabindex');
  };
  const timer = window.setTimeout(cleanup, 4000);
  return cleanup;
}
