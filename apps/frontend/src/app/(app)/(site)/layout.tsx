import { LayoutComponent } from '@gitroom/frontend/components/new-layout/layout.component';
import { cookies } from 'next/headers';
import {
  parseStudioIdentity,
  studioCookieName,
} from '@gitroom/helpers/utils/base-path';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = parseStudioIdentity(
    (await cookies()).get(studioCookieName('identity'))?.value
  );
  return <LayoutComponent identity={identity}>{children}</LayoutComponent>;
}
