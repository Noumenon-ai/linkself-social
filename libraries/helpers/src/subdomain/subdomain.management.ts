import { studioBasePath } from '@gitroom/helpers/utils/base-path';
import { parse } from 'tldts';

export function getCookieUrlFromDomain(domain: string) {
  // A shared LinkSelf host must not receive domain-wide Studio cookies.
  if (studioBasePath()) return undefined;
  const url = parse(domain);
  return url.domain! ? '.' + url.domain! : url.hostname!;
}
