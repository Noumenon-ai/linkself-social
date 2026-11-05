'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { Button } from '@gitroom/react/form/button';

export default function AccountAction() {
  const query = useSearchParams();
  const router = useRouter();
  const fetch = useFetch();
  const { linkselfUrl } = useVariables();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!linkselfUrl) return null;
  if (query.get('action') === 'logout') return <LogoutComponent />;
  return (
    <section className="glass-settings-content p-4">
      <p>Join the workspace in this invitation?</p>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/user/join-org', {
              method: 'POST',
              body: JSON.stringify({ org: query.get('org') }),
            });
            const result = await response.json();
            if (!response.ok || !result.id) throw new Error();
            const changed = await fetch('/user/change-org', {
              method: 'POST',
              body: JSON.stringify({ id: result.id }),
            });
            if (!changed.ok) throw new Error();
            router.push('/launches?added=true');
          } catch {
            setError(
              'Could not join this workspace. Check the invitation and try again.'
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Joining...' : 'Join workspace'}
      </Button>
      <Button secondary onClick={() => router.push('/launches')}>
        Cancel
      </Button>
    </section>
  );
}
