import { APP_NAME } from '@gitroom/helpers/app-name';
export const dynamic = 'force-dynamic';
import { Forgot } from '@gitroom/frontend/components/auth/forgot';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `${APP_NAME} Forgot Password`,
  description: '',
};
export default async function Auth() {
  return <Forgot />;
}
