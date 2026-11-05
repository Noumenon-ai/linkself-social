'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { linkselfPath } from '@gitroom/helpers/utils/base-path';
import { usePathname } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';

import { usePendingNavigation } from '@gitroom/frontend/components/layout/navigation.highlight';

export const studioPages = [
  { label: 'Calendar', path: '/launches' },
  { label: 'Post analytics', path: '/analytics' },
  { label: 'Media', path: '/media' },
  { label: 'Campaigns', path: '/dashboard/campaigns' },
  { label: 'Settings', path: '/settings' },
];

export const isStudioPage = (pathname: string, path: string) => {
  return (
    pathname === path ||
    pathname.startsWith(`${path}/`) ||
    (path === '/settings' && pathname === '/plugs')
  );
};

export const StudioTabs = () => {
  const { linkselfUrl, frontEndUrl } = useVariables();
  const pathname = usePathname();
  const { pending, onNavigate } = usePendingNavigation();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);
  if (!linkselfUrl) return null;
  const base = linkselfUrl.replace(/\/$/, '');

  return (
    <nav
      ref={nav}
      className="glass-studio-tabs glass-settings-tabs flex"
      aria-label="Studio"
      data-navigation-pending={pending || undefined}
    >
      {studioPages.map(({ label, path }) =>
        path === '/dashboard/campaigns' ? (
          <a
            data-navigation-pending={pending === path || undefined}
            onClick={(event) => onNavigate(event, path)}
            key={path}
            href={linkselfPath(linkselfUrl, `${base}${path}`, frontEndUrl)}
          >
            {label}
          </a>
        ) : (
          <Link
            key={path}
            href={path}
            aria-current={isStudioPage(pathname, path) ? 'page' : undefined}
            data-navigation-pending={pending === path || undefined}
            onClick={(event) => onNavigate(event, path)}
          >
            {label}
          </Link>
        )
      )}
    </nav>
  );
};
