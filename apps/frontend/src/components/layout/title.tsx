'use client';

import { usePathname } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useMemo } from 'react';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
export const Title = () => {
  const path = usePathname();
  const { linkselfUrl } = useVariables();
  const { all: menuItems } = useMenuItem();
  const currentTitle = useMemo(() => {
    return menuItems.find((item) => path.indexOf(item.path) > -1)?.name;
  }, [path]);

  return <h1 className="truncate">{linkselfUrl ? 'Studio' : currentTitle}</h1>;
};
