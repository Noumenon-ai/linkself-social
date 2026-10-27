import { APP_NAME } from '@gitroom/helpers/app-name';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: `${APP_NAME} - Agent`,
  description: '',
};

export default async function Page() {
  return redirect('/agents/new');
}
