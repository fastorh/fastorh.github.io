import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import xss from 'xss';
import { Request } from 'express';
import { prisma } from '../config/database';
import { tokenService } from './token.service';
import { emailService } from './email.service';
import { logger } from '../utils/logger';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  TokenExpiredError,
  TokenInvalidError,
  AccountLockedError,
  UseGoogleLoginError,
  DisposableEmailError,
  TooManyRequestsError,
  SessionCompromisedError,
  AppError,
} from '../utils/errors';
import { env } from '../config/env';
import { User } from '@prisma/client';

export type SafeUser = Omit<User, 'password'>;

const DUMMY_HASH = '$2b$12$dummyhashtopreventtimingattacksxxxxxxxxxxxxxxxxxxxxxxxxx';

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','tempmail.com','guerrillamail.com','throwam.com',
  '10minutemail.com','yopmail.com','sharklasers.com','trashmail.com',
  'maildrop.cc','fakeinbox.com','spamgourmet.com','dispostable.com',
]);

const COMMON_PASSWORDS = new Set([
  'password','12345678','123456789','password1','qwerty123',
  'iloveyou','admin123','letmein1','welcome1','monkey123',
]);

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return DISPOSABLE_DOMAINS.has(domain);
}

function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

function sanitizeName(raw: string): string {
  return xss(raw.trim().slice(0, 100));
}

function toSafeUser(user: User): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...safe } = user;
  return safe;
}

async function checkAccountLock(user: User): Promise<void> {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AccountLockedError(minutesLeft);
  }
}

async function recordFailedLogin(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const attempts = (user?.failedLoginAttempts ?? 0) + 1;

  let lockedUntil: Date | null = null;
  if (attempts >= 15) lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  else if (attempts >= 10) lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
  else if (attempts >= 5) lockedUntil = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: attempts, lockedUntil, lastFailedLoginAt: new Date() },
  });

  if (attempts === 5) {
    emailService.sendSecurityAlert(user?.email ?? '', user?.name ?? '', 'failed_attempts', {
      ip: undefined,
      attempts,
    }).catch(() => {});
  }
}

async function recordSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastFailedLoginAt: null },
  });
}

async function checkEmailRateLimit(email: string, ip: string): Promise<void> {
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);
  const count = await prisma.loginAttemptByEmail.count({
    where: { email, attemptedAt: { gte: windowStart } },
  });
  if (count >= 10) throw new TooManyRequestsError('Demasiados intentos para este email. Espera 15 minutos.');
  await prisma.loginAttemptByEmail.create({ data: { email, ipAddress: ip } });
}

async function isKnownDevice(userId: string, fingerprint: string): Promise<boolean> {
  const existing = await prisma.session.findFirst({ where: { userId, deviceFingerprint: fingerprint, isRevoked: false } });
  return existing !== null;
}

export const authService = {
  async register(data: { email: string; password: string; name: string }): Promise<{ user: SafeUser; message: string }> {
    if (isDisposableEmail(data.email)) throw new DisposableEmailError();
    if (isCommonPassword(data.password)) throw new AppError('La contraseña es demasiado común. Elige una más segura.', 400, 'COMMON_PASSWORD');
    if (data.password.toLowerCase().includes(data.email.split('@')[0].toLowerCase())) {
      throw new AppError('La contraseña no puede contener tu email.', 400, 'PASSWORD_CONTAINS_EMAIL');
    }

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new EmailAlreadyExistsError();

    const hashedPassword = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);
    const name = sanitizeName(data.name);

    const user = await prisma.user.create({
      data: { email: data.email, password: hashedPassword, name, provider: 'LOCAL', emailVerified: false },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, token: rawToken, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });

    emailService.sendVerificationEmail(user.email, user.name, rawToken).catch(() => {});

    await prisma.auditLog.create({ data: { userId: user.id, action: 'REGISTER_SUCCESS' } });

    return { user: toSafeUser(user), message: 'Registro exitoso. Revisa tu email para verificar tu cuenta.' };
  },

  async login(data: { email: string; password: string }, req: Request): Promise<{ user: SafeUser; accessToken: string; refreshToken: string }> {
    const ip = req.ip ?? 'unknown';
    await checkEmailRateLimit(data.email, ip);

    const user = await prisma.user.findUnique({ where: { email: data.email } });

    // Timing-safe: siempre ejecutar bcrypt aunque el usuario no exista
    const passwordToCheck = user?.password ?? DUMMY_HASH;
    const isValidPassword = await bcrypt.compare(data.password, passwordToCheck);

    if (!user || !isValidPassword) {
      if (user) await recordFailedLogin(user.id);
      await prisma.auditLog.create({ data: { userId: user?.id ?? null, action: 'LOGIN_FAILED', ipAddress: ip, userAgent: req.headers['user-agent']?.slice(0, 500) } });
      throw new InvalidCredentialsError();
    }

    if (user.provider === 'GOOGLE' && !user.password) throw new UseGoogleLoginError();

    await checkAccountLock(user);

    if (!user.emailVerified) throw new EmailNotVerifiedError();

    await recordSuccessfulLogin(user.id);

    const fingerprint = tokenService.getDeviceFingerprint(req);
    const knownDevice = await isKnownDevice(user.id, fingerprint);
    if (!knownDevice) {
      emailService.sendSecurityAlert(user.email, user.name, 'new_device', { ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    }

    const accessToken = tokenService.generateAccessToken(user.id, user.email, user.tokenVersion);
    const refreshToken = tokenService.generateRefreshToken(user.id);
    await tokenService.createSession(user.id, refreshToken, req);

    await prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN_SUCCESS', ipAddress: ip, userAgent: req.headers['user-agent']?.slice(0, 500) } });

    return { user: toSafeUser(user), accessToken, refreshToken };
  },

  async verifyEmail(token: string): Promise<{ message: string }> {
    const record = await prisma.emailVerificationToken.findUnique({ where: { token }, include: { user: true } });
    if (!record) throw new TokenInvalidError();
    if (record.expiresAt < new Date()) {
      await prisma.emailVerificationToken.delete({ where: { id: record.id } });
      throw new TokenExpiredError('El enlace de verificación ha expirado. Solicita uno nuevo.');
    }

    await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    await prisma.emailVerificationToken.delete({ where: { id: record.id } });
    emailService.sendWelcomeEmail(record.user.email, record.user.name).catch(() => {});

    return { message: 'Email verificado exitosamente.' };
  },

  async refreshTokens(rawRefreshToken: string, req: Request): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = tokenService.verifyRefreshToken(rawRefreshToken);
    const userId = payload.sub;

    const activeSessions = await prisma.session.findMany({ where: { userId, isRevoked: false } });
    let currentSession = null;
    for (const s of activeSessions) {
      if (await bcrypt.compare(rawRefreshToken, s.refreshToken)) {
        currentSession = s;
        break;
      }
    }

    if (!currentSession) {
      // Buscar en previousToken para detectar reutilización
      const allSessions = await prisma.session.findMany({ where: { userId } });
      let isReuse = false;
      for (const s of allSessions) {
        if (s.previousToken && await bcrypt.compare(rawRefreshToken, s.previousToken)) {
          isReuse = true;
          break;
        }
      }

      if (isReuse) {
        await prisma.session.updateMany({ where: { userId }, data: { isRevoked: true, reuseDetectedAt: new Date() } });
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) emailService.sendSecurityAlert(user.email, user.name, 'token_reuse').catch(() => {});
        await prisma.auditLog.create({ data: { userId, action: 'TOKEN_REUSE_DETECTED', ipAddress: req.ip } });
        throw new SessionCompromisedError();
      }

      throw new TokenInvalidError();
    }

    if (currentSession.isRevoked) throw new TokenInvalidError('Sesión revocada.');
    if (currentSession.expiresAt < new Date()) throw new TokenExpiredError();
    if (currentSession.absoluteExpiresAt < new Date()) {
      await prisma.session.update({ where: { id: currentSession.id }, data: { isRevoked: true } });
      throw new AppError('La sesión ha expirado. Por favor inicia sesión nuevamente.', 401, 'SESSION_ABSOLUTE_EXPIRED');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new TokenInvalidError();

    const newRefreshToken = tokenService.generateRefreshToken(userId);
    const hashedNew = await bcrypt.hash(newRefreshToken, 10);

    await prisma.session.update({
      where: { id: currentSession.id },
      data: { isRevoked: true, previousToken: currentSession.refreshToken },
    });

    await prisma.session.create({
      data: {
        userId,
        refreshToken: hashedNew,
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        ipAddress: req.ip ?? null,
        deviceFingerprint: tokenService.getDeviceFingerprint(req),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        absoluteExpiresAt: currentSession.absoluteExpiresAt,
      },
    });

    const newAccessToken = tokenService.generateAccessToken(userId, user.email, user.tokenVersion);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  async logout(rawRefreshToken: string): Promise<void> {
    await tokenService.revokeSession(rawRefreshToken);
  },

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const GENERIC_MSG = 'Si el email está registrado, recibirás instrucciones para restablecer tu contraseña.';
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.provider === 'GOOGLE') return { message: GENERIC_MSG };

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token: rawToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    emailService.sendPasswordResetEmail(user.email, user.name, rawToken).catch(() => {});
    await prisma.auditLog.create({ data: { userId: user.id, action: 'PASSWORD_RESET_REQUESTED' } });

    return { message: GENERIC_MSG };
  },

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    if (isCommonPassword(newPassword)) throw new AppError('La contraseña es demasiado común.', 400, 'COMMON_PASSWORD');

    const record = await prisma.passwordResetToken.findUnique({ where: { token }, include: { user: true } });
    if (!record) throw new TokenInvalidError();
    if (record.expiresAt < new Date()) throw new TokenExpiredError('El enlace de restablecimiento ha expirado.');
    if (record.usedAt) throw new TokenInvalidError('Este enlace ya fue utilizado.');

    if (newPassword.toLowerCase().includes(record.user.email.split('@')[0].toLowerCase())) {
      throw new AppError('La contraseña no puede contener tu email.', 400, 'PASSWORD_CONTAINS_EMAIL');
    }

    const hashedPassword = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
    });
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tokenService.revokeAllUserSessions(record.userId);

    emailService.sendSecurityAlert(record.user.email, record.user.name, 'password_changed').catch(() => {});
    await prisma.auditLog.create({ data: { userId: record.userId, action: 'PASSWORD_RESET_COMPLETED' } });

    return { message: 'Contraseña restablecida exitosamente.' };
  },

  async handleGoogleCallback(googleUser: User, req: Request): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
    const isNewUser = Date.now() - googleUser.createdAt.getTime() < 10_000;

    const fingerprint = tokenService.getDeviceFingerprint(req);
    const knownDevice = await isKnownDevice(googleUser.id, fingerprint);
    if (!knownDevice && !isNewUser) {
      emailService.sendSecurityAlert(googleUser.email, googleUser.name, 'new_device', {
        ip: req.ip ?? undefined,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
    }

    const accessToken = tokenService.generateAccessToken(googleUser.id, googleUser.email, googleUser.tokenVersion);
    const refreshToken = tokenService.generateRefreshToken(googleUser.id);
    await tokenService.createSession(googleUser.id, refreshToken, req);

    if (isNewUser) emailService.sendWelcomeEmail(googleUser.email, googleUser.name).catch(() => {});

    await prisma.auditLog.create({ data: { userId: googleUser.id, action: 'GOOGLE_LOGIN_SUCCESS', ipAddress: req.ip } });

    return { accessToken, refreshToken, isNewUser };
  },

  async getUserById(id: string): Promise<SafeUser | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? toSafeUser(user) : null;
  },

  async getUserSessions(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true, deviceFingerprint: true },
    });
    return sessions;
  },

  async revokeSessionById(sessionId: string, userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { isRevoked: true },
    });
  },

  async revokeAllSessionsExcept(userId: string, currentRefreshToken: string): Promise<void> {
    await tokenService.revokeAllUserSessionsExcept(userId, currentRefreshToken);
    emailService.sendSecurityAlert(
      (await prisma.user.findUnique({ where: { id: userId } }))?.email ?? '',
      (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? '',
      'sessions_revoked'
    ).catch(() => {});
  },
};
