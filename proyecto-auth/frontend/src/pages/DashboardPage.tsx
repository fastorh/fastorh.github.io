import { useAuth } from '../hooks/useAuth';
import { LogOut, User, Shield } from 'lucide-react';

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">A</span>
          </div>
          <span className="font-semibold text-gray-800">Mi App</span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition"
        >
          <LogOut size={15} />
          Cerrar sesión
        </button>
      </nav>

      <main className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center gap-4">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
                <User size={28} className="text-indigo-600" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">¡Hola, {user?.name}!</h1>
              <p className="text-gray-500 text-sm">{user?.email}</p>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${user?.provider === 'GOOGLE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                {user?.provider === 'GOOGLE' ? '🔵 Google' : '📧 Email'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <Shield size={20} className="text-green-600 flex-shrink-0" />
          <div>
            <p className="text-green-800 font-medium text-sm">Autenticación completamente funcional</p>
            <p className="text-green-700 text-xs mt-0.5">Email verificado: {user?.emailVerified ? 'Sí' : 'No'} · ID: {user?.id?.slice(0, 8)}...</p>
          </div>
        </div>
      </main>
    </div>
  );
}
