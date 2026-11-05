'use client';
import { FC, ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';
import { linkselfPath } from '@gitroom/helpers/utils/base-path';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  active?: boolean;
}> = ({ label, icon, path, onClick, active }) => {
  const currentPath = usePathname();
  const query = useSearchParams();
  const { linkselfUrl, frontEndUrl } = useVariables();
  const [pathname, search] = path.split('?');
  const settingsTab = query.get('tab') || 'global_settings';
  const isActive =
    active ??
    (linkselfUrl
      ? path === '/plugs'
        ? currentPath === '/plugs' ||
          (currentPath === '/settings' && settingsTab === 'plugs')
        : currentPath === pathname &&
          (search
            ? settingsTab === new URLSearchParams(search).get('tab')
            : pathname !== '/settings' ||
              settingsTab === 'global_settings')
      : currentPath.indexOf(path) === 0);

  const className = clsx(
    'glass-rail-link group w-full minCustom:h-[54px] custom:h-[44px] py-[8px] px-[6px] minCustom:gap-[4px] custom:gap-[2px] flex flex-col font-[600] items-center justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused transition-colors',
    isActive ? 'text-textItemFocused bg-boxFocused' : 'text-textItemBlur'
  );

  const inner = (
    <>
      <div className="custom:scale-90 transition-transform">{icon}</div>
      <div className="glass-rail-label custom:text-[9px] minCustom:text-[10px] leading-[1.1] text-center">
        {label}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        onClick={onClick}
        title={linkselfUrl ? undefined : label}
        className={className}
      >
        {inner}
      </button>
    );
  }

  if (linkselfUrl && path.startsWith(linkselfUrl.replace(/\/$/, '') + '/')) {
    return (
      <a href={linkselfPath(linkselfUrl, path, frontEndUrl)} aria-label={label} className={className}>
        {inner}
      </a>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      aria-label={label}
      title={linkselfUrl ? undefined : label}
      aria-current={isActive ? 'page' : undefined}
      {...(path.indexOf('http') === 0 &&
        !(linkselfUrl && path.startsWith(linkselfUrl.replace(/\/$/, ''))) && {
          target: '_blank',
        })}
      className={className}
    >
      {inner}
    </Link>
  );
};
