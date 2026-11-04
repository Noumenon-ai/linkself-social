'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export const StudioTabs = () => {
  const { linkselfUrl } = useVariables();
  const pathname = usePathname();
  if (!linkselfUrl) return null;

  const base = linkselfUrl.replace(/\/$/, '');
  const tabs = [
    { label: 'Calendar', path: '/launches' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Media', path: '/media' },
    { label: 'Settings', path: '/settings' },
    { label: 'Channels setup', path: `${base}/dashboard/social` },
    { label: 'Campaigns', path: `${base}/dashboard/campaigns` },
  ];

  return (
    <nav
      className="glass-studio-tabs glass-settings-tabs flex"
      aria-label="Studio"
    >
      {tabs.map(({ label, path }) => (
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
