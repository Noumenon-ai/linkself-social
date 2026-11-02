'use client';

import { ReactNode, useMemo } from 'react';
import { PreviewWrapper } from '@gitroom/frontend/components/preview/preview.wrapper';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname } from 'next/navigation';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);
export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { linkselfUrl } = useVariables();
  const params = usePathname();
  const style = useMemo(() => {
    const all = params.split('/');
    all.pop();
    return all.pop();
  }, [params]);
  return (
    <div
      className={`hideCopilot ${style} h-[100vh] w-full text-textColor flex flex-1 flex-col !bg-none`}
    >
      <style>
        {!linkselfUrl ? `
          #add-edit-modal, .hideCopilot {
            background: transparent !important;
          }
          html body.dark, html {
            background: transparent !important;
          }
        ` : ''}
      </style>
      <PreviewWrapper>{children}</PreviewWrapper>
    </div>
  );
};
