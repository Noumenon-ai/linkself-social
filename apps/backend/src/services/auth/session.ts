import { randomUUID } from 'crypto';
import { studioCookieName, studioCookiePath } from '@gitroom/helpers/utils/base-path';
import { Response } from 'express';
import { User } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

export function createSessionToken(user: User): string {
  const sessionUser = { ...user };
  delete sessionUser.password;
  return AuthService.signJWT({ ...sessionUser, ...(process.env.LINKSELF_URL ? { sessionId: randomUUID() } : {}) });
}

export function setSessionCookies(
  response: Response,
  jwt: string,
  organizationId?: string
) {
  const options = {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    path: studioCookiePath(),
    ...(process.env.LINKSELF_URL ? { sameSite: 'lax' as const } : {}),
    ...(!process.env.NOT_SECURED
      ? { secure: true, httpOnly: true, sameSite: process.env.LINKSELF_URL ? 'lax' as const : 'none' as const }
      : {}),
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
  };
  response.cookie(studioCookieName('auth'), jwt, options);
  if (process.env.NOT_SECURED) response.header('auth', jwt);
  if (organizationId) {
    response.cookie(studioCookieName('showorg'), organizationId, options);
    if (process.env.NOT_SECURED) response.header('showorg', organizationId);
  }
}
