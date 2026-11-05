'use client';

import { usePathname } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useMemo } from 'react';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import {
  studioPages,
  isStudioPage,
} from '@gitroom/frontend/components/layout/studio.tabs';

const StandaloneTitle = () => {
  const path = usePathname();
  const { all: menuItems } = useMenuItem();
  const currentTitle = useMemo(() => {
    return menuItems.find((item) => path.indexOf(item.path) > -1)?.name;
  }, [path]);

  return <h1 className="truncate">{currentTitle}</h1>;
};

export const Title = () => {
  const path = usePathname();
  const { linkselfUrl } = useVariables();
  if (!linkselfUrl) return <StandaloneTitle />;
  const title =
    studioPages.find((page) => isStudioPage(path, page.path))?.label || 'Studio';
  return <h1>{title}</h1>;
};
