import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import xss from 'xss';
import { prisma } from './database';
import { env } from './env';
import { logger } from '../utils/logger';

const GOOGLE_AVATAR_DOMAINS = ['googleusercontent.com', 'lh3.google.com', 'lh4.google.com'];

function isGoogleAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return GOOGLE_AVATAR_DOMAINS.some(d => parsed.hostname.endsWith(d));
  } catch {
    return false;
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ['email', 'profile'],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // Solo aceptar email verificado
        const email =
          (profile.emails as Array<{ value: string; verified?: boolean }>)?.find(e => e.verified)?.value ??
          profile.emails?.[0]?.value;

        if (!email) {
          return done(new Error('No se pudo obtener un email verificado de Google.'));
        }

        const googleId = profile.id;
        const name = sanitizeName(profile.displayName ?? email.split('@')[0]);
        const avatarRaw = profile.photos?.[0]?.value ?? '';
        const avatar = avatarRaw && isGoogleAvatarUrl(avatarRaw) ? avatarRaw : null;

        // 1. Buscar por googleId
        let user = await prisma.user.findUnique({ where: { googleId } });
        if (user) return done(null, user);

        // 2. Buscar por email
        const existingByEmail = await prisma.user.findUnique({ where: { email } });

        if (existingByEmail) {
          // Verificar que no hay conflicto de googleId
          if (existingByEmail.googleId && existingByEmail.googleId !== googleId) {
            logger.warn('Google ID conflict', { email, newGoogleId: googleId, existingGoogleId: existingByEmail.googleId });
            return done(new Error('Esta cuenta ya está vinculada a otra cuenta de Google.'));
          }

          // Vincular googleId al usuario existente
          user = await prisma.user.update({
            where: { id: existingByEmail.id },
            data: { googleId, avatar: existingByEmail.avatar ?? avatar },
          });
          return done(null, user);
        }

        // 3. Crear usuario nuevo
        user = await prisma.user.create({
          data: {
            email,
            name,
            avatar,
            provider: 'GOOGLE',
            googleId,
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });

        return done(null, user);
      } catch (err) {
        logger.error('Error en Google OAuth callback', { error: err });
        return done(err as Error);
      }
    }
  )
);

function sanitizeName(raw: string): string {
  return xss(raw.trim().slice(0, 100));
}

export default passport;
