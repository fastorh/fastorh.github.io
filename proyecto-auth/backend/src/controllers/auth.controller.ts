import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import passport from 'passport';
import { authService } from '../services/auth.service';
import { env } from '../config/env';
import { User } from '@prisma/client';
import { prisma } from '../config/database';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, REFRESH_COOKIE_OPTIONS);
}

function setXsrfCookie(res: Response): string {
  const xsrfToken = crypto.randomBytes(16).toString('hex');
  res.cookie('XSRF-TOKEN', xsrfToken, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return xsrfToken;
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.clearCookie('XSRF-TOKEN');
  res.setHeader('Clear-Site-Data', '"cache", "storage"');
}

export const authController = {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.register(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  },

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, accessToken, refreshToken } = await authService.login(req.body, req);
      setRefreshCookie(res, refreshToken);
      setXsrfCookie(res);
      res.status(200).json({ user, accessToken });
    } catch (err) { next(err); }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.cookies?.refreshToken ?? req.body?.refreshToken;
      if (token) await authService.logout(token);
      clearAuthCookies(res);
      res.status(200).json({ message: 'Sesión cerrada exitosamente.' });
    } catch (err) { next(err); }
  },

  async refreshTokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.cookies?.refreshToken;
      if (!token) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Refresh token no encontrado' });
        return;
      }
      const { accessToken, refreshToken } = await authService.refreshTokens(token, req);
      setRefreshCookie(res, refreshToken);
      setXsrfCookie(res);
      res.status(200).json({ accessToken });
    } catch (err) { next(err); }
  },

  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.query.token as string;
      if (!token) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Token requerido' });
        return;
      }
      const result = await authService.verifyEmail(token);
      res.status(200).json(result);
    } catch (err) { next(err); }
  },

  async requestPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.requestPasswordReset(req.body.email);
      res.status(200).json(result);
    } catch (err) { next(err); }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.resetPassword(req.body.token, req.body.newPassword);
      res.status(200).json(result);
    } catch (err) { next(err); }
  },

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.getUserById(req.user!.id);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Usuario no encontrado' });
        return;
      }
      res.status(200).json({ user });
    } catch (err) { next(err); }
  },

  googleAuth(req: Request, res: Response, next: NextFunction): void {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
    passport.authenticate('google', {
      scope: ['email', 'profile'],
      session: false,
      state,
    })(req, res, next);
  },

  googleCallback(req: Request, res: Response, next: NextFunction): void {
    const storedState = req.cookies?.oauth_state;
    const returnedState = req.query.state as string;

    if (!storedState || !returnedState || storedState !== returnedState) {
      res.clearCookie('oauth_state');
      res.redirect(`${env.FRONTEND_URL}/?oauth_error=csrf_failed`);
      return;
    }

    res.clearCookie('oauth_state');

    passport.authenticate('google', { session: false, failureRedirect: `${env.FRONTEND_URL}/?oauth_error=oauth_failed` }, async (err: Error | null, user: User | false) => {
      if (err || !user) {
        return res.redirect(`${env.FRONTEND_URL}/?oauth_error=oauth_failed`);
      }
      try {
        const { accessToken, refreshToken, isNewUser } = await authService.handleGoogleCallback(user, req);
        setRefreshCookie(res, refreshToken);
        setXsrfCookie(res);
        // Redirige al index.html con el token en el query param (se limpia con JS)
        res.redirect(`${env.FRONTEND_URL}/?oauth_token=${accessToken}&new=${isNewUser}`);
      } catch (callbackErr) {
        next(callbackErr);
      }
    })(req, res, next);
  },

  async getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessions = await authService.getUserSessions(req.user!.id);
      res.status(200).json({ sessions });
    } catch (err) { next(err); }
  },

  async revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await authService.revokeSessionById(req.params.sessionId, req.user!.id);
      res.status(200).json({ message: 'Sesión revocada.' });
    } catch (err) { next(err); }
  },

  async revokeAllSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const currentToken = req.cookies?.refreshToken;
      if (currentToken) {
        await authService.revokeAllSessionsExcept(req.user!.id, currentToken);
      } else {
        await authService.revokeAllSessionsExcept(req.user!.id, '');
      }
      res.status(200).json({ message: 'Todas las otras sesiones han sido cerradas.' });
    } catch (err) { next(err); }
  },

  async listCalcs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const calcs = await prisma.savedCalc.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, type: true, name: true, data: true, createdAt: true },
      });
      res.status(200).json({ calcs });
    } catch (err) { next(err); }
  },

  async saveCalc(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { type, name, data } = req.body;
      if (!type || !data) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'type y data son requeridos' });
        return;
      }
      const calc = await prisma.savedCalc.create({
        data: { userId: req.user!.id, type, name: name || type, data },
        select: { id: true, type: true, name: true, data: true, createdAt: true },
      });
      res.status(201).json({ calc });
    } catch (err) { next(err); }
  },

  async deleteCalc(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await prisma.savedCalc.deleteMany({
        where: { id: req.params.calcId, userId: req.user!.id },
      });
      res.status(200).json({ message: 'Cálculo eliminado.' });
    } catch (err) { next(err); }
  },
};
