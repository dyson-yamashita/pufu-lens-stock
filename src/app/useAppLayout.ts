import { useEffect, useState } from 'react';

export function useAppLayout(resetPage: () => void) {
  const [mobileNav, setMobileNav] = useState(false);

  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);

  const pageSize = isMobile ? 6 : 24;

  const sidebarOpen = isMobile ? mobileNav : !desktopNavCollapsed;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const listener = () => {
      setIsMobile(media.matches);
      resetPage();
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    document.getElementById('sidebar-close')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.getElementById('sidebar-toggle')?.focus();
    };
  }, [mobileNav, isMobile]);
  return {
    mobileNav,
    setMobileNav,
    desktopNavCollapsed,
    setDesktopNavCollapsed,
    isMobile,
    pageSize,
    sidebarOpen,
  };
}
