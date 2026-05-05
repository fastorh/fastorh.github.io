export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Credenciales inválidas') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor(message = 'Debes verificar tu email antes de iniciar sesión') {
    super(message, 403, 'EMAIL_NOT_VERIFIED');
  }
}

export class EmailAlreadyExistsError extends AppError {
  constructor(message = 'Este email ya está registrado') {
    super(message, 409, 'EMAIL_ALREADY_EXISTS');
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'El token ha expirado') {
    super(message, 401, 'TOKEN_EXPIRED');
  }
}

export class TokenInvalidError extends AppError {
  constructor(message = 'Token inválido') {
    super(message, 401, 'TOKEN_INVALID');
  }
}

export class UserNotFoundError extends AppError {
  constructor(message = 'Usuario no encontrado') {
    super(message, 404, 'USER_NOT_FOUND');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiados intentos. Intenta más tarde.') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

export class AccountLockedError extends AppError {
  constructor(minutesLeft: number) {
    super(`Cuenta bloqueada. Intenta en ${minutesLeft} minuto${minutesLeft !== 1 ? 's' : ''}.`, 423, 'ACCOUNT_LOCKED');
  }
}

export class UseGoogleLoginError extends AppError {
  constructor() {
    super('Esta cuenta fue creada con Google. Usa el botón de Google para iniciar sesión.', 400, 'USE_GOOGLE_LOGIN');
  }
}

export class DisposableEmailError extends AppError {
  constructor() {
    super('No se permiten direcciones de email temporales o desechables.', 400, 'DISPOSABLE_EMAIL');
  }
}

export class SessionCompromisedError extends AppError {
  constructor() {
    super('Sesión comprometida. Se han cerrado todas las sesiones por seguridad.', 401, 'SESSION_COMPROMISED');
  }
}

export class CsrfError extends AppError {
  constructor() {
    super('Token CSRF inválido.', 403, 'CSRF_INVALID');
  }
}
