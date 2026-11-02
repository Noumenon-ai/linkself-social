import { BlueprintBrand } from '@gitroom/frontend/components/ui/blueprint-brand';
import { APP_NAME } from '@gitroom/helpers/app-name';
import SafeImage from '@gitroom/react/helpers/safe.image';

export const LogoTextComponent = () => (
  <><BlueprintBrand wordmark /><span className="blueprint-upstream-brand"><SafeImage src="/logo-text.svg" width={202} height={33} alt={APP_NAME} /></span></>
);
