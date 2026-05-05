import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { authApi } from '../services/api';
import { User } from '../types/auth.types';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const token = params.get('token');
    const isNew = params.get('new') === 'true';

    if (!token) {
      navigate('/login?error=oauth_failed', { replace: true });
      return;
    }

    // Limpiar query params de la URL inmediatamente (seguridad)
    window.history.replaceState({}, '', window.location.pathname);

    // Guardar token y obtener usuario
    useAuthStore.getState().setAccessToken(token);
    authApi.getMe()
      .then(({ data }) => {
        setAuth(data.user as User, token);
        navigate(isNew ? '/welcome' : '/dashboard', { replace: true });
      })
      .catch(() => {
        navigate('/login?error=oauth_failed', { replace: true });
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={48} className="text-indigo-600 animate-spin mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Iniciando sesión con Google...</p>
      </div>
    </div>
  );
}
