import { APP_NAME } from '@gitroom/helpers/app-name';
import { MediaLayoutComponent } from '@gitroom/frontend/components/new-layout/layout.media.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `${APP_NAME} Media`,
  description: '',
};

export default async function Page() {
  return <MediaLayoutComponent />
}
