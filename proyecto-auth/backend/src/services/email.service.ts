import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: env.EMAIL_HOST,
  port: env.EMAIL_PORT,
  secure: env.EMAIL_SECURE,
  auth: {
    user: env.EMAIL_USER,
    pass: env.EMAIL_PASSWORD,
  },
});

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  try {
    await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
  } catch (err) {
    logger.error('Error enviando email', { to, subject, error: err });
  }
}

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;
`;
const btnStyle = `
  display: inline-block; padding: 12px 28px; background: #4f46e5;
  color: #ffffff; text-decoration: none; border-radius: 8px;
  font-weight: 600; font-size: 15px; margin: 24px 0;
`;

export const emailService = {
  async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const url = `${env.FRONTEND_URL}/verify-email?token=${token}`;
    const html = `
      <div style="${baseStyle}">
        <h2 style="margin-bottom:8px;">Hola, ${name} 👋</h2>
        <p>Gracias por registrarte. Haz click en el botón para verificar tu dirección de email.</p>
        <a href="${url}" style="${btnStyle}">Verificar mi cuenta</a>
        <p style="font-size:13px;color:#666;">Este enlace expira en 24 horas.<br>Si no creaste una cuenta, ignora este mensaje.</p>
      </div>`;
    const text = `Hola ${name},\nVerifica tu cuenta en: ${url}\nEste enlace expira en 24 horas.`;
    await send(to, 'Verifica tu cuenta', html, text);
  },

  async sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
    const url = `${env.FRONTEND_URL}/reset-password?token=${token}`;
    const html = `
      <div style="${baseStyle}">
        <h2 style="margin-bottom:8px;">Restablecer contraseña</h2>
        <p>Hola ${name}, recibimos una solicitud para restablecer tu contraseña.</p>
        <a href="${url}" style="${btnStyle}">Restablecer contraseña</a>
        <p style="font-size:13px;color:#666;">⚠️ Este enlace expira en <strong>1 hora</strong>.<br>Si no solicitaste esto, ignora este mensaje. Tu contraseña no cambiará.</p>
      </div>`;
    const text = `Hola ${name},\nRestablece tu contraseña en: ${url}\nEste enlace expira en 1 hora.`;
    await send(to, 'Restablecer contraseña', html, text);
  },

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const html = `
      <div style="${baseStyle}">
        <h2 style="margin-bottom:8px;">¡Bienvenido, ${name}! 🎉</h2>
        <p>Tu cuenta ha sido verificada exitosamente. Ya puedes iniciar sesión y comenzar a usar la app.</p>
        <a href="${env.FRONTEND_URL}/login" style="${btnStyle}">Ir a la app</a>
      </div>`;
    const text = `¡Bienvenido ${name}! Tu cuenta fue verificada. Inicia sesión en: ${env.FRONTEND_URL}/login`;
    await send(to, '¡Bienvenido!', html, text);
  },

  async sendSecurityAlert(
    to: string,
    name: string,
    type: 'new_device' | 'password_changed' | 'sessions_revoked' | 'token_reuse' | 'failed_attempts',
    meta?: { ip?: string; userAgent?: string; attempts?: number }
  ): Promise<void> {
    const templates: Record<string, { subject: string; body: string }> = {
      new_device: {
        subject: 'Nuevo inicio de sesión detectado',
        body: `<p>Se detectó un acceso desde un dispositivo no reconocido.<br>IP: <strong>${meta?.ip ?? 'desconocida'}</strong><br>Dispositivo: ${meta?.userAgent ?? 'desconocido'}</p><p>Si no fuiste tú, <a href="${env.FRONTEND_URL}/forgot-password">cambia tu contraseña</a> de inmediato.</p>`,
      },
      password_changed: {
        subject: 'Tu contraseña fue cambiada',
        body: `<p>La contraseña de tu cuenta fue cambiada exitosamente desde la IP: <strong>${meta?.ip ?? 'desconocida'}</strong>.<br>Si no fuiste tú, <a href="${env.FRONTEND_URL}/forgot-password">recupera tu acceso</a> de inmediato.</p>`,
      },
      sessions_revoked: {
        subject: 'Todas las sesiones han sido cerradas',
        body: `<p>Hola ${name}, todas tus sesiones activas han sido cerradas por seguridad. Si no realizaste esta acción, <a href="${env.FRONTEND_URL}/forgot-password">cambia tu contraseña</a>.</p>`,
      },
      token_reuse: {
        subject: '⚠️ ALERTA DE SEGURIDAD - Actividad sospechosa detectada',
        body: `<p><strong>Detectamos actividad sospechosa en tu cuenta.</strong><br>Se intentó usar un token de sesión ya utilizado, lo que puede indicar que alguien robó tus credenciales.<br>Todas tus sesiones han sido cerradas automáticamente como medida de seguridad.</p><p><a href="${env.FRONTEND_URL}/forgot-password" style="color:#dc2626;">Cambia tu contraseña ahora</a></p>`,
      },
      failed_attempts: {
        subject: `${meta?.attempts ?? 5} intentos fallidos de acceso a tu cuenta`,
        body: `<p>Detectamos <strong>${meta?.attempts ?? 5} intentos fallidos</strong> de inicio de sesión en tu cuenta desde la IP: ${meta?.ip ?? 'desconocida'}.<br>Si no fuiste tú, <a href="${env.FRONTEND_URL}/forgot-password">cambia tu contraseña</a> de inmediato.</p>`,
      },
    };

    const tpl = templates[type];
    const html = `<div style="${baseStyle}"><h2 style="margin-bottom:8px;">Alerta de seguridad</h2>${tpl.body}</div>`;
    const text = tpl.body.replace(/<[^>]+>/g, '');
    await send(to, tpl.subject, html, text);
  },
};
