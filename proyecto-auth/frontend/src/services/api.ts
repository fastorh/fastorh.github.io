import axios, { AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';
import { LoginFormData, RegisterFormData } from '../types/auth.types';

// BroadcastChannel para sincronizar entre pestañas
const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('auth') : null;

authChannel?.addEventListener('message', (event) => {
  const store = useAuthStore.getState();
  if (event.data.type === 'TOKEN_REFRESH') {
    store.setAccessToken(event.data.accessToken);
  }
  if (event.data.type === 'LOGOUT') {
    store.clearAuth();
    window.location.href = '/login';
  }
});

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-Token',
});

// Interceptor REQUEST: inyectar access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Control de refresh concurrente
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}
function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

// Interceptor RESPONSE: manejar 401 y refresh automático
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const code = error.response?.data?.error;

    if (status === 401 && !originalRequest._retry && code !== 'INVALID_CREDENTIALS') {
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            if (originalRequest.headers) {
              (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${token}`;
            }
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await api.post<{ accessToken: string }>('/auth/refresh');
        const newToken = data.accessToken;
        useAuthStore.getState().setAccessToken(newToken);
        authChannel?.postMessage({ type: 'TOKEN_REFRESH', accessToken: newToken });
        isRefreshing = false;
        onRefreshed(newToken);
        if (originalRequest.headers) {
          (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        }
        return api(originalRequest);
      } catch {
        isRefreshing = false;
        refreshSubscribers = [];
        useAuthStore.getState().clearAuth();
        authChannel?.postMessage({ type: 'LOGOUT' });
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// Refresh preventivo al volver de segundo plano
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const { accessToken, isAuthenticated } = useAuthStore.getState();
      if (isAuthenticated && accessToken) {
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          const expiresIn = payload.exp * 1000 - Date.now();
          if (expiresIn < 60_000) {
            api.post<{ accessToken: string }>('/auth/refresh').then(({ data }) => {
              useAuthStore.getState().setAccessToken(data.accessToken);
              authChannel?.postMessage({ type: 'TOKEN_REFRESH', accessToken: data.accessToken });
            }).catch(() => {
              useAuthStore.getState().clearAuth();
            });
          }
        } catch {}
      }
    }
  });
}

export const authApi = {
  register: (data: Omit<RegisterFormData, 'confirmPassword'>) =>
    api.post('/auth/register', data),

  login: (data: LoginFormData) =>
    api.post<{ user: unknown; accessToken: string }>('/auth/login', data),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get<{ user: unknown }>('/auth/me'),

  verifyEmail: (token: string) =>
    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`),

  requestPasswordReset: (email: string) =>
    api.post('/auth/request-password-reset', { email }),

  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, newPassword }),

  refreshToken: () =>
    api.post<{ accessToken: string }>('/auth/refresh'),

  getSessions: () => api.get('/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeAllSessions: () => api.delete('/auth/sessions'),
};
