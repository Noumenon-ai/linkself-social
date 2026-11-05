'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useCallback } from 'react';
import useSWR from 'swr';

export const useIntegrationList = () => {
  const fetch = useFetch();
  const { linkselfUrl } = useVariables();

  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (linkselfUrl && !response.ok)
      throw new Error('Could not load the channel list');
    return (await response.json()).integrations;
  }, [fetch, linkselfUrl]);

  return useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};