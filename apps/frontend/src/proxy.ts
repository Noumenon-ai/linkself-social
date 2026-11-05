import { withBasePath, frontendUrl, studioCookieName, studioCookiePath } from '@gitroom/helpers/utils/base-path';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

// This function can be marked `async` if using `await` inside
async function routeRequest(request: NextRequest, securityHeaders?: Record<string, string>) {
  const nextUrl = request.nextUrl;
  const authCookie =
    request.cookies.get(studioCookieName('auth')) ||
    request.headers.get('auth') ||
    nextUrl.searchParams.get('loggedAuth');
  const lng = process.env.LINKSELF_URL ? 'en' : request.cookies.has(cookieName)
    ? acceptLanguage.get(request.cookies.get(cookieName).value)
    : acceptLanguage.get(
        request.headers.get('Accept-Language') ||
          request.headers.get('accept-language')
      );

  const requestHeaders = new Headers(request.headers);
  for (const [key, value] of Object.entries(securityHeaders || {})) requestHeaders.set(key, value);
  if (lng) {
    requestHeaders.set(headerName, lng);
  }

  const topResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (lng) {
    topResponse.headers.set(cookieName, lng);
  }

  if (nextUrl.pathname.startsWith('/modal/') && !authCookie) {
    return NextResponse.redirect(new URL(withBasePath(`/auth/login-required`), nextUrl.href));
  }

  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/provider/') ||
    nextUrl.pathname.startsWith('/icons/') ||
    // the consent screen of MCP / OAuth clients handles signed-out visitors
    // itself (sign in and come back, or connect a self-hosted instance)
    nextUrl.pathname.startsWith('/oauth/authorize')
  ) {
    return topResponse;
  }

  if (
    nextUrl.pathname.startsWith('/integrations/social/') &&
    nextUrl.href.indexOf('state=login') === -1
  ) {
    return topResponse;
  }

  if (process.env.LINKSELF_URL && nextUrl.pathname === '/auth/logout') {
    return NextResponse.redirect(new URL(withBasePath('/account-action?action=logout'), nextUrl.href));
  }
  if (process.env.LINKSELF_URL && authCookie && nextUrl.searchParams.has('org') && nextUrl.pathname !== '/account-action') {
    const target = new URL(withBasePath('/account-action'), nextUrl.href);
    target.searchParams.set('org', nextUrl.searchParams.get('org')!);
    return NextResponse.redirect(target);
  }

  // If the URL is logout, delete the cookie and redirect to login
  if (!process.env.LINKSELF_URL && nextUrl.href.indexOf('/auth/logout') > -1) {
    const response = NextResponse.redirect(
      new URL(withBasePath('/auth/login'), nextUrl.href)
    );
    response.cookies.set(studioCookieName('auth'), '', {
      path: studioCookiePath(),
      ...(process.env.LINKSELF_URL ? { sameSite: 'lax' as const } : {}),

      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: process.env.LINKSELF_URL ? 'lax' : false,
          }
        : {}),
      maxAge: -1,
      domain: getCookieUrlFromDomain(frontendUrl()),
    });
    return response;
  }

  if (
    nextUrl.pathname.startsWith('/auth/register') &&
    process.env.DISABLE_REGISTRATION === 'true'
  ) {
    return NextResponse.redirect(new URL(withBasePath('/auth/login'), nextUrl.href));
  }

  const org = process.env.LINKSELF_URL ? null : nextUrl.searchParams.get('org');
  const url = new URL(nextUrl).search;
  if (!nextUrl.pathname.startsWith('/auth') && !authCookie) {
    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);
    const additional = !findIndex
      ? ''
      : (url.indexOf('?') > -1 ? '&' : '?') +
        `provider=${(findIndex === 'settings'
          ? process.env.POSTIZ_GENERIC_OAUTH
            ? 'generic'
            : 'github'
          : findIndex
        ).toUpperCase()}`;
    return NextResponse.redirect(
      new URL(withBasePath(`/auth${url}${additional}`), nextUrl.href)
    );
  }

  // If the url is /auth and the cookie exists, redirect to /
  if (nextUrl.pathname.startsWith('/auth') && authCookie) {
    return NextResponse.redirect(new URL(withBasePath(`/${url}`), nextUrl.href));
  }
  if (nextUrl.pathname.startsWith('/auth') && !authCookie) {
    if (org) {
      const redirect = NextResponse.redirect(new URL(withBasePath(`/`), nextUrl.href));
      redirect.cookies.set(studioCookieName('org'), org, {
        path: studioCookiePath(),
      ...(process.env.LINKSELF_URL ? { sameSite: 'lax' as const } : {}),
        ...(!process.env.NOT_SECURED
          ? {

              secure: true,
              httpOnly: true,
              sameSite: process.env.LINKSELF_URL ? 'lax' : false,
              domain: getCookieUrlFromDomain(frontendUrl()),
            }
          : {}),
        expires: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });
      return redirect;
    }
    return topResponse;
  }
  try {
    if (org) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({
            org,
          }),
          method: 'POST',
        })
      ).json();
      const redirect = NextResponse.redirect(
        new URL(withBasePath(`/?added=true`), nextUrl.href)
      );
      if (id) {
        redirect.cookies.set(studioCookieName('showorg'), id, {
          path: studioCookiePath(),
      ...(process.env.LINKSELF_URL ? { sameSite: 'lax' as const } : {}),
          ...(!process.env.NOT_SECURED
            ? {

                secure: true,
                httpOnly: true,
                sameSite: process.env.LINKSELF_URL ? 'lax' : false,
                domain: getCookieUrlFromDomain(frontendUrl()),
              }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        });
      }
      return redirect;
    }
    if (nextUrl.pathname === '/') {
      return NextResponse.redirect(
        new URL(
          withBasePath(!!process.env.IS_GENERAL ? '/launches' : `/analytics`),
          nextUrl.href
        )
      );
    }

    return topResponse;
  } catch (err) {
    console.log('err', err);
    return NextResponse.redirect(new URL(withBasePath('/auth/logout'), nextUrl.href));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};

export async function proxy(request: NextRequest) {
  if (!process.env.LINKSELF_URL) return routeRequest(request);
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const apiOrigin = process.env.NEXT_PUBLIC_BACKEND_URL
    ? new URL(process.env.NEXT_PUBLIC_BACKEND_URL).origin : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    `form-action 'self' ${new URL(process.env.LINKSELF_URL).origin}`,
  ].join('; ');
  const response = await routeRequest(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
