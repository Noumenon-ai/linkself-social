import { APP_NAME } from '@gitroom/helpers/app-name';
export const dynamic = 'force-dynamic';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `${APP_NAME} Login`,
  description: '',
};
export default async function Auth() {
  return <Login />;
}
