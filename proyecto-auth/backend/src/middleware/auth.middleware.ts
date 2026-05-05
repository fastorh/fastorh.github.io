import { Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/token.service';
import { prisma } from '../config/database';
import { TokenInvalidError } from '../utils/errors';
import { CsrfError } from '../utils/errors';

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token de acceso requerido' });
      return;
    }

    const payload = tokenService.verifyAccessToken(token);

    // Verificar tokenVersion y que el usuario exista
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, provider: true, tokenVersion: true },
    });

    if (!user) {
      res.status(401).json({ error: 'USER_NOT_FOUND', message: 'Usuario no encontrado' });
      return;
    }

    if (user.tokenVersion !== payload.version) {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token revocado' });
      return;
    }

    req.user = { id: user.id, email: user.email, name: user.name, provider: user.provider };
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const payload = tokenService.verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, provider: true, tokenVersion: true },
    });

    if (user && user.tokenVersion === payload.version) {
      req.user = { id: user.id, email: user.email, name: user.name, provider: user.provider };
    }
    next();
  } catch {
    next();
  }
}

export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const headerToken = req.headers['x-xsrf-token'] as string | undefined;
  const cookieToken = req.cookies['XSRF-TOKEN'] as string | undefined;

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    res.status(403).json({ error: 'CSRF_INVALID', message: 'Token CSRF inválido' });
    return;
  }
  next();
}

export function addSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
