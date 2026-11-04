'use client';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export function SourceAttribution() {
  const { linkselfUrl } = useVariables();
  if (!linkselfUrl)
    return (
      <footer className="text-xs text-center py-4">
        Built on Postiz (AGPL-3.0). Source:{' '}
        <a
          className="underline"
          href="https://github.com/Noumenon-ai/linkself-social"
        >
          https://github.com/Noumenon-ai/linkself-social
        </a>
      </footer>
    );
  return (
    <a
      className="glass-source-link"
      href="https://github.com/Noumenon-ai/linkself-social"
    >
      Open source
    </a>
  );
}
