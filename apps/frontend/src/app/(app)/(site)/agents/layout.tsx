export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { APP_NAME } from '@gitroom/helpers/app-name';
import { Metadata } from 'next';
import { Agent } from '@gitroom/frontend/components/agents/agent';
export const metadata: Metadata = {
  title: `${APP_NAME} - Agent`,
  description: 'agents',
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!process.env.OPENAI_API_KEY) redirect('/launches');
  return <Agent>{children}</Agent>;
}
