import './config/env'; // Validar env primero
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import cron from 'node-cron';
import path from 'path';
import { Prisma } from '@prisma/client';

import { env } from './config/env';
import './config/passport';
import passport from './config/passport';
import { prisma } from './config/database';
import authRoutes from './routes/auth.routes';
import { AppError } from './utils/errors';
import { logger } from './utils/logger';

const app = express();

// ── Seguridad ────────────────────────────────────────────────────
// CSP relajado para permitir el index.html estático con scripts inline y Google Fonts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = [env.FRONTEND_URL];
if (env.NODE_ENV === 'development') {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-XSRF-Token'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(passport.initialize());

// Rate limit global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Logging de requests ─────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ── Rutas ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV });
});

app.use('/api/auth', authRoutes);

// ── Servir index.html estático desde la raíz del proyecto ────────
// __dirname apunta a src/; subimos 3 niveles para llegar a dinero/
const staticRoot = path.join(__dirname, '..', '..', '..');
app.use(express.static(staticRoot));
// El Google OAuth callback redirige a /?oauth_token=... — enviamos index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// ── Error handler global ─────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'CONFLICT', message: 'El recurso ya existe.' });
    }
  }

  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'JSON inválido en el body.' });
  }

  logger.error('Error no manejado', { error: err });
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'production' ? 'Error interno del servidor.' : String(err),
  });
});

// ── Cron jobs de limpieza ────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  logger.info('Ejecutando limpieza nocturna...');
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    await prisma.session.deleteMany({ where: { OR: [{ isRevoked: true, createdAt: { lt: cutoff } }, { expiresAt: { lt: new Date() } }] } });
    await prisma.passwordResetToken.deleteMany({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }] } });
    await prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.loginAttemptByEmail.deleteMany({ where: { attemptedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    logger.info('Limpieza nocturna completada.');
  } catch (err) {
    logger.error('Error en limpieza nocturna', { error: err });
  }
});

// ── Start ────────────────────────────────────────────────────────
const PORT = env.PORT;
app.listen(PORT, () => {
  logger.info(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/health`);
});

export default app;
