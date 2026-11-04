import { GlassBrand } from '@gitroom/frontend/components/ui/glass-brand';
import { APP_NAME } from '@gitroom/helpers/app-name';
import SafeImage from '@gitroom/react/helpers/safe.image';

export const LogoTextComponent = () => (
  <><GlassBrand wordmark /><span className="glass-upstream-brand"><SafeImage src="/logo-text.svg" width={202} height={33} alt={APP_NAME} /></span></>
);
