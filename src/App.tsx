import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AutomacaoOS from "./pages/AutomacaoOS";
import ApontamentoTarefa from "./pages/ApontamentoTarefa";
import SaldoHoras from "./pages/SaldoHoras";
import StatusReport from "./pages/StatusReport";
import Admin from "./pages/Admin";
import Clientes from "./pages/Clientes";
import LancamentoOS from "./pages/LancamentoOS";
import Relatorios from "./pages/Relatorios";
import Usuarios from "./pages/Usuarios";
import Rotinas from "./pages/Rotinas";
import Envios from "./pages/Envios";
import ModelosEmail from "./pages/ModelosEmail";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,  // evita refetch ao voltar na aba
      staleTime: 5 * 60 * 1000,    // dados ficam "fresh" por 5 min
      gcTime: 10 * 60 * 1000,      // cache mantido por 10 min
      retry: 1,
    },
  },
});

/**
 * Mapeamento rota → moduleKey deve ser idêntico ao definido em AppLayout.tsx.
 * Rotas sem moduleKey são acessíveis a qualquer usuário autenticado.
 * Administradores passam em todas as rotas independentemente.
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Pública */}
            <Route path="/login" element={<Login />} />

            {/* Visão Geral — sem moduleKey, visível para todos os autenticados */}
            <Route path="/" element={<ProtectedRoute><ErrorBoundary><Dashboard /></ErrorBoundary></ProtectedRoute>} />

            {/* Operação */}
            <Route path="/lancamento-os"  element={<ProtectedRoute moduleKey="lancamento_os"><ErrorBoundary><LancamentoOS /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/relatorios"     element={<ProtectedRoute moduleKey="relatorios"><ErrorBoundary><Relatorios /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/saldo-horas"    element={<ProtectedRoute moduleKey="saldo_horas"><ErrorBoundary><SaldoHoras /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/status-report"  element={<ProtectedRoute moduleKey="status_report"><ErrorBoundary><StatusReport /></ErrorBoundary></ProtectedRoute>} />

            {/* Automação */}
            <Route path="/automacao-os"        element={<ProtectedRoute moduleKey="automacao_os"><ErrorBoundary><AutomacaoOS /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/apontamento-tarefa"  element={<ProtectedRoute moduleKey="lancamento_os"><ErrorBoundary><ApontamentoTarefa /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/rotinas"        element={<ProtectedRoute moduleKey="automacao_os"><ErrorBoundary><Rotinas /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/envios"         element={<ProtectedRoute moduleKey="status_report"><ErrorBoundary><Envios /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/modelos-email"  element={<ProtectedRoute moduleKey="modelos"><ErrorBoundary><ModelosEmail /></ErrorBoundary></ProtectedRoute>} />

            {/* Cadastros */}
            <Route path="/clientes"       element={<ProtectedRoute moduleKey="clientes"><ErrorBoundary><Clientes /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/usuarios"       element={<ProtectedRoute moduleKey="usuarios"><ErrorBoundary><Usuarios /></ErrorBoundary></ProtectedRoute>} />

            {/* Sistema */}
            <Route path="/admin"          element={<ProtectedRoute moduleKey="admin"><ErrorBoundary><Admin /></ErrorBoundary></ProtectedRoute>} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
