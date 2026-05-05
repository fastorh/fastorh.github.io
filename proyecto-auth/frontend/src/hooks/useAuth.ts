import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { authApi } from '../services/api';
import { LoginFormData, RegisterFormData, User } from '../types/auth.types';

export function useAuth() {
  const store = useAuthStore();
  const navigate = useNavigate();

  const initialize = useCallback(async () => {
    store.setLoading(true);
    try {
      const { data: refreshData } = await authApi.refreshToken();
      store.setAccessToken(refreshData.accessToken);
      const { data: meData } = await authApi.getMe();
      store.setAuth(meData.user as User, refreshData.accessToken);
    } catch {
      store.clearAuth();
    }
  }, []);

  const login = useCallback(async (data: LoginFormData) => {
    const res = await authApi.login(data);
    const { user, accessToken } = res.data;
    store.setAuth(user as User, accessToken);
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('returnUrl') ?? '/dashboard';
    navigate(returnUrl, { replace: true });
  }, [navigate]);

  const register = useCallback(async (data: RegisterFormData) => {
    const { confirmPassword, ...payload } = data;
    void confirmPassword;
    const res = await authApi.register(payload);
    return res.data as { message: string };
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch {}
    store.clearAuth();
    navigate('/login', { replace: true });
  }, [navigate]);

  const loginWithGoogle = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? '/api';
    window.location.href = `${apiUrl}/auth/google`;
  }, []);

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    accessToken: store.accessToken,
    initialize,
    login,
    register,
    logout,
    loginWithGoogle,
  };
}
