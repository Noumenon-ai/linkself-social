import { APP_NAME } from '@gitroom/helpers/app-name';
import SafeImage from '@gitroom/react/helpers/safe.image';

export const LogoTextComponent = () => (
  <SafeImage src="/logo-text.svg" width={202} height={33} alt={APP_NAME} />
);
