import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { isIP } from 'net';

const isPublicComment = (method: string, url: string) =>
  method === 'POST' && /^\/public\/posts\/[^/]+\/comments/.test(url);

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (
      (method === 'POST' && url.includes('/public/v1/posts')) ||
      isPublicComment(method, url)
    ) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (!req.org) {
      const forwarded = String(req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
      return 'ip_' + (forwarded || req.ip || 'unknown');
    }

    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '');
    return forwarded.split(',')[0].trim() || req.ip;
  }
}

// IPv6 clients usually hold a whole /64, so the sign-in forms count attempts
// per /64 network for IPv6 and per address for IPv4
const clientNetwork = (address: string) => {
  const ip = address
    .split('%')[0]
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (isIP(ip) !== 6) {
    return ip;
  }

  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];

  return (
    groups
      .slice(0, 4)
      .map((group) => parseInt(group, 16).toString(16))
      .join(':') + '::/64'
  );
};

// route-level guard for the login and register forms. The first
// x-forwarded-for entry is whatever the client sent, so key by the address
// Cloudflare sets, else the hop the nearest proxy appended. This assumes the
// backend is reachable only through that proxy.
@Injectable()
export class ThrottlerSignInGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    const cloudflare = String(req.headers?.['cf-connecting-ip'] || '').trim();
    const forwarded = String(req.headers?.['x-forwarded-for'] || '')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    return clientNetwork(
      cloudflare || forwarded[forwarded.length - 1] || req.ip || 'unknown'
    );
  }
}
