import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { TokenExpiredError, TokenInvalidError } from '../utils/errors';

interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  version: number;
  jti: string;
}

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

function getDeviceFingerprint(req: Request): string {
  const raw = [
    req.headers['user-agent'] ?? '',
    req.headers['accept-language'] ?? '',
    req.headers['accept-encoding'] ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export const tokenService = {
  generateAccessToken(userId: string, email: string, tokenVersion: number): string {
    return jwt.sign(
      { sub: userId, email, type: 'access', version: tokenVersion },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'], jwtid: crypto.randomUUID() }
    );
  },

  generateRefreshToken(userId: string): string {
    return jwt.sign(
      { sub: userId, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );
  },

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, env.JWT_ACCESS_SECRET, { clockTolerance: 30 }) as AccessTokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
      throw new TokenInvalidError();
    }
  },

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return jwt.verify(token, env.JWT_REFRESH_SECRET, { clockTolerance: 30 }) as RefreshTokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
      throw new TokenInvalidError();
    }
  },

  async createSession(userId: string, refreshToken: string, req: Request) {
    const hashedToken = await bcrypt.hash(refreshToken, 10);
    const fingerprint = getDeviceFingerprint(req);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    return prisma.session.create({
      data: {
        userId,
        refreshToken: hashedToken,
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        ipAddress: req.ip ?? null,
        deviceFingerprint: fingerprint,
        expiresAt,
        absoluteExpiresAt,
      },
    });
  },

  async revokeSession(refreshToken: string): Promise<void> {
    const sessions = await prisma.session.findMany({ where: { isRevoked: false } });
    for (const session of sessions) {
      const match = await bcrypt.compare(refreshToken, session.refreshToken);
      if (match) {
        await prisma.session.update({ where: { id: session.id }, data: { isRevoked: true } });
        return;
      }
    }
  },

  async revokeAllUserSessions(userId: string): Promise<void> {
    await prisma.session.updateMany({ where: { userId }, data: { isRevoked: true } });
  },

  async revokeAllUserSessionsExcept(userId: string, currentRefreshToken: string): Promise<void> {
    const sessions = await prisma.session.findMany({ where: { userId, isRevoked: false } });
    for (const session of sessions) {
      const isCurrent = await bcrypt.compare(currentRefreshToken, session.refreshToken);
      if (!isCurrent) {
        await prisma.session.update({ where: { id: session.id }, data: { isRevoked: true } });
      }
    }
  },

  getDeviceFingerprint,
};
