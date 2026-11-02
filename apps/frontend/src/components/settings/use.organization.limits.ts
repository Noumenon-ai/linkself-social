'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import type { OrganizationLimitsResponse } from '@gitroom/nestjs-libraries/dtos/enterprise/organization.limits.dto';

export const useOrganizationLimits = () => {
  const fetch = useFetch();
  const user = useUser();
  return useSWR<OrganizationLimitsResponse>(
    user?.orgId ? ['organization-limits', user.orgId] : null,
    async () => {
      const response = await fetch('/settings/limits');
      if (!response.ok) throw new Error('Could not load organization limits');
      return response.json();
    }
  );
};
