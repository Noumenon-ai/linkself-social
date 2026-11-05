'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';

export default function ConnectionStart() {
  const params = useSearchParams();
  const fetch = useFetch();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="glass-settings-content p-4">
      <p>Continue to connect your channel.</p>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/integrations/session', {
              method: 'POST',
              body: JSON.stringify({ state: params.get('state') }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) throw new Error();
            window.location.assign(data.url);
          } catch {
            setError(
              'Could not start this connection. Please connect the channel again.'
            );
            setBusy(false);
          }
        }}
      >
        {busy ? 'Connecting...' : 'Continue'}
      </Button>
    </section>
  );
}
