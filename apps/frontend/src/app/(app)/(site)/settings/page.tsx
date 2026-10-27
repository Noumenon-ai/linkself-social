import { SourceAttribution } from '@gitroom/frontend/components/auth/source-attribution';
import { APP_NAME } from '@gitroom/helpers/app-name';
import { SettingsPopup } from '@gitroom/frontend/components/layout/settings.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `${APP_NAME} Settings`,
  description: '',
};
export default async function Index(props: {
  searchParams: Promise<{
    code: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  return <><SettingsPopup /><SourceAttribution /></>;
}
