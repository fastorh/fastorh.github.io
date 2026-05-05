import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller';
import { validate, registerSchema, loginSchema, requestPasswordResetSchema, resetPasswordSchema } from '../middleware/validate.middleware';
import { authenticate, verifyCsrf, addSecurityHeaders } from '../middleware/auth.middleware';

const router = Router();

// Aplicar headers de seguridad a todos los endpoints de auth
router.use(addSecurityHeaders);

// Rate limiters específicos por endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos fallidos. Espera 15 minutos.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Demasiados registros desde esta IP. Espera 1 hora.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes de reseteo. Espera 1 hora.' },
});

const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rutas públicas ──────────────────────────────────────────────
router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', refreshLimiter, verifyCsrf, authController.refreshTokens);
router.get('/verify-email', verifyEmailLimiter, authController.verifyEmail);
router.post('/request-password-reset', passwordResetLimiter, validate(requestPasswordResetSchema), authController.requestPasswordReset);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// ── Google OAuth ────────────────────────────────────────────────
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);

// ── Rutas protegidas ────────────────────────────────────────────
router.get('/me', authenticate, authController.getMe);
router.get('/sessions', authenticate, authController.getSessions);
router.delete('/sessions/:sessionId', authenticate, authController.revokeSession);
router.delete('/sessions', authenticate, authController.revokeAllSessions);

// ── Cálculos guardados ──────────────────────────────────────────
router.get('/calcs', authenticate, authController.listCalcs);
router.post('/calcs', authenticate, authController.saveCalc);
router.delete('/calcs/:calcId', authenticate, authController.deleteCalc);

export default router;
