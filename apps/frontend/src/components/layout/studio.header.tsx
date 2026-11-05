'use client';

import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import copy from 'copy-to-clipboard';
import { linkselfPath, StudioIdentity } from '@gitroom/helpers/utils/base-path';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Title } from '@gitroom/frontend/components/layout/title';
import NotificationComponent, {
  NotificationBell,
} from '@gitroom/frontend/components/notifications/notification.component';

const SharePage = ({ username }: { username: string }) => {
  const { linkselfUrl, frontEndUrl } = useVariables();
  const toast = useToaster();
  const url = new URL(
    linkselfPath(linkselfUrl, `/${username}`, frontEndUrl),
    linkselfUrl
  ).toString();
  const choices = [
    [
      'X',
      `https://twitter.com/intent/tweet?text=Check%20out%20my%20LinkSelf%20page!&url=${encodeURIComponent(
        url
      )}`,
    ],
    [
      'Facebook',
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    ],
    [
      'WhatsApp',
      `https://wa.me/?text=${encodeURIComponent(
        `Check out my LinkSelf page: ${url}`
      )}`,
    ],
  ];
  return (
    <div className="glass-share-page">
      <p>@{username}</p>
      <a
        href={linkselfPath(linkselfUrl, `/${username}`, frontEndUrl)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>
      <Button
        onClick={() => {
          copy(url);
          toast.show('Link copied to clipboard', 'success');
        }}
      >
        Copy link
      </Button>
      <div className="glass-share-choices">
        {choices.map(([label, href]) => (
          <a
            className="glass-header-button"
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        ))}
      </div>
      <a
        className="glass-header-button"
        href={linkselfPath(linkselfUrl, '/dashboard/qr', frontEndUrl)}
      >
        QR code
      </a>
    </div>
  );
};

export const StudioHeader = ({
  identity,
  loaded,
}: {
  identity?: StudioIdentity;
  loaded: boolean;
}) => {
  const { linkselfUrl, frontEndUrl } = useVariables();
  const modal = useModals();
  return (
    <header className="glass-topbar glass-studio-header relative">
      <div className="glass-heading glass-page-identity">
        <div className="glass-title">
          <Title />
        </div>
        {identity && (
          <>
            <span className="glass-handle">@{identity.username}</span>
            <span className="glass-plan">{identity.plan}</span>
          </>
        )}
      </div>
      <div className="glass-header-actions">
        {loaded ? (
          <>
            <StreakComponent />
            <OrganizationSelector />
            <NotificationComponent />
          </>
        ) : (
          <span
            className="glass-notification-target"
            aria-label="Notifications"
          >
            <NotificationBell />
          </span>
        )}
        {identity && (
          <>
            <a
              className="glass-header-button"
              href={linkselfPath(
                linkselfUrl,
                `/${identity.username}`,
                frontEndUrl
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              View live page
            </a>
            <button
              className="glass-header-button glass-share-button"
              type="button"
              aria-label="Share your page"
              onClick={() =>
                modal.openModal({
                  id: 'share-linkself',
                  title: 'Share your page',
                  size: 440,
                  closeOnClickOutside: true,
                  closeOnEscape: true,
                  children: <SharePage username={identity.username} />,
                })
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98" />
              </svg>
              <span>Share</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
