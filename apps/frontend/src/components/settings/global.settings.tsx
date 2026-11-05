'use client';

import { withBasePath, linkselfPath } from '@gitroom/helpers/utils/base-path';

import { useVariables } from '@gitroom/react/helpers/variable.context';
import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
import AuthenticationComponent from '@gitroom/frontend/components/settings/authentication.component';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';

const MetricComponent = dynamic(
  () => import('@gitroom/frontend/components/settings/metric.component'),
  {
    ssr: false,
  }
);

export const GlobalSettings = () => {
  const { emailEnabled, dub, linkselfUrl, frontEndUrl } = useVariables();
  const t = useT();
  return (
    <div className="glass-global-settings flex flex-col">
      <h3 className="text-[20px]">{t('global_settings', 'Global Settings')}</h3>
      <AuthenticationComponent />
      <MetricComponent />
      {emailEnabled && <EmailNotificationsComponent />}
      {dub && <ShortlinkPreferenceComponent />}
      {linkselfUrl ? (
        <p>
          Your account is managed and deleted in{' '}
          <a
            href={linkselfPath(linkselfUrl, '/dashboard/settings', frontEndUrl)}
            className="underline"
          >
            LinkSelf
          </a>.
        </p>
      ) : (
        <DeleteAccountComponent />
      )}
    </div>
  );
};
