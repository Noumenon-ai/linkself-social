'use client';

import { BlueprintBrand } from '@gitroom/frontend/components/ui/blueprint-brand';
import { APP_NAME } from '@gitroom/helpers/app-name';
import SafeImage from '@gitroom/react/helpers/safe.image';

export const Logo = () => (
  <><BlueprintBrand /><span className="blueprint-upstream-brand"><SafeImage
    src="/logo.svg"
    width={60}
    height={60}
    alt={APP_NAME}
    className="mt-[8px] min-w-[60px] min-h-[60px]"
  /></span></>
);
