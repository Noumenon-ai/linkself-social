'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { usePathname } from 'next/navigation';

export const usePendingNavigation = () => {
  const [pending, setPending] = useState<string | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    setPending(null);
  }, [pathname]);
  useEffect(() => {
    const clear = () => setPending(null);
    window.addEventListener('pageshow', clear);
    return () => window.removeEventListener('pageshow', clear);
  }, []);

  const onNavigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.currentTarget.target === '_blank' ||
      event.currentTarget.hasAttribute('download')
    )
      return;
    setPending(path);
  };

  return { pending, onNavigate };
};
