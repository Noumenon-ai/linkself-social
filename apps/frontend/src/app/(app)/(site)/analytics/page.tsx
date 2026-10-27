import { APP_NAME } from '@gitroom/helpers/app-name';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
export const metadata: Metadata = {
  title: `${APP_NAME} Analytics`,
  description: '',
};
export default async function Index() {
  return <PlatformAnalytics />;
}
