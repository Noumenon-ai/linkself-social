import { Response } from 'express';
import { User } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

export function createSessionToken(user: User): string {
  const sessionUser = { ...user };
  delete sessionUser.password;
  return AuthService.signJWT(sessionUser);
}

export function setSessionCookies(
  response: Response,
  jwt: string,
  organizationId?: string
) {
  const options = {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    ...(!process.env.NOT_SECURED
      ? { secure: true, httpOnly: true, sameSite: 'none' as const }
      : {}),
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
  };
  response.cookie('auth', jwt, options);
  if (process.env.NOT_SECURED) response.header('auth', jwt);
  if (organizationId) {
    response.cookie('showorg', organizationId, options);
    if (process.env.NOT_SECURED) response.header('showorg', organizationId);
  }
}
