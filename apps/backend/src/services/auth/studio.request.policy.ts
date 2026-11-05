import { NextFunction, Request, Response } from 'express';

export function studioRequestPolicy(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!process.env.LINKSELF_URL) return next();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  const serverRoute =
    /^\/(?:public\/(?:v1(?:\/|$)|api(?:\/|$))|enterprise(?:\/|$)|mcp(?:\/|$)|stripe(?:\/|$)|payments?\/webhook(?:\/|$))/.test(
      req.path
    );
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    !serverRoute &&
    req.headers.origin
  ) {
    if (req.headers.origin !== new URL(process.env.FRONTEND_URL!).origin) {
      return res.status(403).json({ message: 'Request origin is not allowed' });
    }
  }
  return next();
}
