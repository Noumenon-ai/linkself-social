'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { linkselfPath } from '@gitroom/helpers/utils/base-path';
import { usePathname } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export const StudioTabs = () => {
  const { linkselfUrl, frontEndUrl } = useVariables();
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);
  if (!linkselfUrl) return null;

  const base = linkselfUrl.replace(/\/$/, '');
  const tabs = [
    { label: 'Calendar', path: '/launches' },
    { label: 'Post analytics', path: '/analytics' },
    { label: 'Media', path: '/media' },
    { label: 'Campaigns', path: `${base}/dashboard/campaigns` },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <nav
      ref={nav}
      className="glass-studio-tabs glass-settings-tabs flex"
      aria-label="Studio"
    >
      {tabs.map(({ label, path }) => path.startsWith(base + '/') ? (
        <a key={path} href={linkselfPath(linkselfUrl, path, frontEndUrl)} className="hover:bg-boxHover">
          {label}
        </a>
      ) : (
        <Link
          key={path}
          href={path}
          aria-current={
            pathname === path ||
            pathname.startsWith(`${path}/`) ||
            (path === '/settings' && pathname === '/plugs')
              ? 'page'
              : undefined
          }
          {...(path.indexOf('http') === 0 &&
            !path.startsWith(base) && {
              target: '_blank',
            })}
          className="hover:bg-boxHover"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
};
