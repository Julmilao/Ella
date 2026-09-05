import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Chave do módulo exigida para acessar esta rota.
   * undefined → acessível a qualquer usuário autenticado.
   * Administradores passam sempre, independente do moduleKey.
   */
  moduleKey?: string;
}

const Spinner = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
);

export default function ProtectedRoute({ children, moduleKey }: ProtectedRouteProps) {
  const { session, isAdmin, moduleAccess, loading, loadingProfile } = useAuth();
  const location = useLocation();

  // 1. Aguarda carregamento da sessão
  if (loading) return <Spinner />;

  // 2. Não autenticado → redireciona para login, preservando a rota de origem
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 3. Aguarda carregamento das permissões (pode chegar um pouco depois da sessão)
  if (loadingProfile) return <Spinner />;

  // 4. Sem moduleKey → acessível a qualquer usuário logado (Dashboard, etc.)
  if (!moduleKey) return <>{children}</>;

  // 5. Admin tem acesso a tudo
  if (isAdmin) return <>{children}</>;

  // 6. Usuário sem permissão → redireciona para o Dashboard silenciosamente
  if (!moduleAccess.has(moduleKey)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
