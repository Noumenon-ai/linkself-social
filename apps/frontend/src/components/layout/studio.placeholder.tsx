'use client';

import { usePathname } from 'next/navigation';

export const StudioPlaceholder = ({
  calendar,
  failed,
}: {
  calendar?: boolean;
  failed?: boolean;
}) => {
  const pathname = usePathname();
  const isCalendar =
    calendar ?? (pathname === '/launches' || pathname.startsWith('/launches/'));
  if (!isCalendar)
    return (
      <div className="glass-page-placeholder glass-frame" aria-hidden="true" />
    );
  return (
    <div
      className="glass-launches glass-launches-placeholder"
      aria-hidden={failed ? undefined : true}
    >
      <div className="glass-calendar-panel bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] mobile:p-[12px] gap-[12px] mobile:min-h-[600px]">
        <div className="glass-toolbar-placeholder" />
        <div className="glass-calendar glass-frame glass-grid-placeholder flex-1 flex">
          {failed && (
            <p role="status" className="glass-placeholder-message">
              We could not load your channels. Trying again.
            </p>
          )}
        </div>
      </div>
      <div className="glass-schedule glass-frame glass-scheduled-placeholder" />
    </div>
  );
};
