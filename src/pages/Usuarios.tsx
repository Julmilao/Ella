import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  Users, User, Search, X, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, AlignJustify, RefreshCw,
  Shield, CheckCircle2, XCircle,
  Loader2, Bot, ClipboardList, ClipboardCheck, BarChart3, Building2, Settings,
  Mail, UserCheck, UserX, KeyRound, CalendarDays,
  Plus, Eye, EyeOff, Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Módulos do sistema ────────────────────────────────────────────────────────
const MODULOS = [
  { key: "lancamento_os", label: "Controle de OS",       icon: ClipboardList, desc: "Solicitação, acompanhamento e apontamento automático de OS" },
  { key: "relatorios",    label: "Relatórios",           icon: BarChart3,     desc: "Análise de apontamentos, filtros por período e consultor" },
  { key: "saldo_horas",   label: "Saldo de Horas",       icon: Search,        desc: "Consultar saldo de horas de clientes" },
  { key: "status_report", label: "Status Report",        icon: BarChart3,     desc: "Envio de relatórios de status" },
  { key: "automacao_os",  label: "Abertura Automática OS",  icon: Bot, desc: "RPA executa a abertura automática das OS solicitadas no Sankhya Experience" },
  { key: "clientes",      label: "Clientes",             icon: Building2,     desc: "Cadastro e gestão de clientes" },
  { key: "usuarios",      label: "Usuários",             icon: Users,         desc: "Gestão de usuários e acessos" },
  { key: "configuracoes", label: "Configurações",        icon: Settings,      desc: "Configurações gerais do sistema" },
  { key: "modelos",       label: "Modelos de Email",     icon: Mail,          desc: "Criação de modelos de e-mail" },
  { key: "admin",         label: "Painel Admin",         icon: Shield,        desc: "Painel administrativo completo" },
];

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface AcessoModulo {
  module_key: string;
  has_access: boolean;
}

interface Usuario {
  id: string;
  user_id: string;
  nome: string | null;
  email: string | null;
  role: "admin" | "user";
  created_at: string;
  user_module_access: AcessoModulo[];
}

type Modo = "grade" | "formulario";
type FiltroUsuario = "todos" | "ativos" | "inativos";

// ── Utilitários ───────────────────────────────────────────────────────────────
function formatarData(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function iniciais(nome: string | null, email: string | null): string {
  const fonte = nome || email || "?";
  const partes = fonte.split(/[\s@]/);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return fonte.slice(0, 2).toUpperCase();
}

function totalAcessos(usuario: Usuario): number {
  return usuario.user_module_access.filter((a) => a.has_access).length;
}

function temAcessoAtivo(usuario: Usuario): boolean {
  return usuario.user_module_access.some((a) => a.has_access);
}

function normalizarErroExclusaoUsuario(message: string): string {
  if (message.includes("Could not find the function public.admin_delete_user")) {
    return "A função de exclusão ainda não existe no banco. Aplique a migration mais recente antes de excluir usuários.";
  }
  if (message.includes("Nao e permitido excluir o proprio usuario")) {
    return "Não é permitido excluir o próprio usuário logado.";
  }
  if (message.includes("Apenas administradores podem excluir usuarios")) {
    return "Apenas administradores podem excluir usuários.";
  }
  if (message.includes("Usuario nao encontrado")) {
    return "Usuário não encontrado.";
  }
  return message;
}

async function lerErroApi(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.clone().json();
    if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
  } catch { /* ignore */ }
  try {
    const text = (await resp.text()).trim();
    if (text) return text;
  } catch { /* ignore */ }
  return fallback;
}

function normalizarErroBackend(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    if (/failed to fetch/i.test(err.message)) {
      return "Não foi possível alcançar o backend. Verifique se o servidor está rodando (uvicorn main:app).";
    }
    return err.message || fallback;
  }
  return fallback;
}

// ── Badge de role ─────────────────────────────────────────────────────────────
function BadgeRole({ role }: { role: "admin" | "user" }) {
  if (role === "admin") {
    return (
      <Badge className="gap-1 text-[10px] py-0 px-1.5 h-5 bg-purple-500/15 text-purple-700 border-purple-500/30 border font-medium">
        <Shield className="h-2.5 w-2.5" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] py-0 px-1.5 h-5 text-muted-foreground">
      <User className="h-2.5 w-2.5" />
      Usuário
    </Badge>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, color, delay,
}: {
  icon: React.ElementType; label: string; value: number; color: string; delay: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      <Card className="border-border bg-card">
        <CardContent className="p-5 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Avatar do usuário ─────────────────────────────────────────────────────────
function AvatarUsuario({ usuario, size = "md" }: { usuario: Usuario; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-7 h-7 text-[10px]" : size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  const cor = usuario.role === "admin"
    ? "bg-purple-500/15 border-purple-500/20 text-purple-700"
    : "bg-primary/15 border-primary/20 text-primary";
  return (
    <div className={`${sz} rounded-xl border flex items-center justify-center shrink-0 font-bold ${cor}`}>
      {iniciais(usuario.nome, usuario.email)}
    </div>
  );
}

// ── Dialog: Novo Usuário ──────────────────────────────────────────────────────
interface NovoUsuarioForm {
  nome: string;
  email: string;
  senha: string;
  role: "admin" | "user";
}

const FORM_VAZIO: NovoUsuarioForm = { nome: "", email: "", senha: "", role: "user" };

function DialogNovoUsuario({
  aberto,
  onClose,
  onCriado,
}: {
  aberto: boolean;
  onClose: () => void;
  onCriado: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<NovoUsuarioForm>(FORM_VAZIO);
  const [erros, setErros] = useState<Partial<Record<keyof NovoUsuarioForm, string>>>({});
  const [salvando, setSalvando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  useEffect(() => {
    if (aberto) { setForm(FORM_VAZIO); setErros({}); setMostrarSenha(false); }
  }, [aberto]);

  const set = <K extends keyof NovoUsuarioForm>(k: K, v: NovoUsuarioForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  function validar(): boolean {
    const e: Partial<Record<keyof NovoUsuarioForm, string>> = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório.";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "E-mail inválido.";
    if (form.senha.length < 6) e.senha = "Senha deve ter pelo menos 6 caracteres.";
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function handleSalvar() {
    if (!validar()) return;
    setSalvando(true);
    try {
      const resp = await apiFetch("/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) throw new Error(await lerErroApi(resp, "Erro ao criar usuário."));
      toast({ title: "Usuário criado", description: `${form.nome} foi adicionado ao sistema.` });
      onCriado();
      onClose();
    } catch (err: any) {
      toast({
        title: "Erro ao criar usuário",
        description: normalizarErroBackend(err, "Erro ao criar usuário."),
        variant: "destructive",
      });
    }
    setSalvando(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Novo Usuário
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            Preencha os dados para criar um novo acesso no sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Nome completo <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.nome}
              onChange={(e) => set("nome", e.target.value)}
              placeholder="Ex: João Silva"
              className="bg-background border-border"
              autoFocus
            />
            {erros.nome && <p className="text-[11px] text-destructive flex items-center gap-1"><XCircle className="h-3 w-3" />{erros.nome}</p>}
          </div>

          {/* E-mail */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              E-mail <span className="text-destructive">*</span>
            </Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="joao.silva@empresa.com"
              className="bg-background border-border font-mono"
            />
            {erros.email && <p className="text-[11px] text-destructive flex items-center gap-1"><XCircle className="h-3 w-3" />{erros.email}</p>}
          </div>

          {/* Senha */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Senha inicial <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                type={mostrarSenha ? "text" : "password"}
                value={form.senha}
                onChange={(e) => set("senha", e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="bg-background border-border pr-10"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {mostrarSenha ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {erros.senha && <p className="text-[11px] text-destructive flex items-center gap-1"><XCircle className="h-3 w-3" />{erros.senha}</p>}
          </div>

          {/* Role */}
          <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
            <div className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${form.role === "admin" ? "bg-purple-500/15 text-purple-700" : "bg-muted text-muted-foreground"}`}>
                <Shield className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {form.role === "admin" ? "Administrador" : "Usuário comum"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {form.role === "admin"
                    ? "Pode criar e gerenciar outros usuários"
                    : "Acessa apenas os módulos liberados"}
                </p>
              </div>
            </div>
            <Switch
              checked={form.role === "admin"}
              onCheckedChange={(v) => set("role", v ? "admin" : "user")}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando} className="border-border">
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando} className="gap-2">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Criar usuário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Reset de Senha ────────────────────────────────────────────────────
function DialogResetSenha({
  usuario,
  aberto,
  onClose,
}: {
  usuario: Usuario | null;
  aberto: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (aberto) { setNovaSenha(""); setConfirmar(""); setErro(""); setMostrar(false); }
  }, [aberto]);

  async function handleSalvar() {
    if (novaSenha.length < 6) { setErro("Senha deve ter pelo menos 6 caracteres."); return; }
    if (novaSenha !== confirmar) { setErro("As senhas não coincidem."); return; }
    if (!usuario) return;
    setErro("");
    setSalvando(true);
    try {
      const resp = await apiFetch(`/usuarios/${usuario.user_id}/reset-senha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nova_senha: novaSenha }),
      });
      if (!resp.ok) throw new Error(await lerErroApi(resp, "Erro ao redefinir senha."));
      toast({ title: "Senha redefinida", description: `A nova senha de ${usuario.nome || usuario.email} foi salva.` });
      onClose();
    } catch (err: any) {
      setErro(normalizarErroBackend(err, "Erro ao redefinir senha."));
    }
    setSalvando(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Redefinir senha
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {usuario && (
              <>Nova senha para <span className="font-semibold text-foreground">{usuario.nome || usuario.email}</span>.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nova senha</Label>
            <div className="relative">
              <Input
                type={mostrar ? "text" : "password"}
                value={novaSenha}
                onChange={(e) => { setNovaSenha(e.target.value); setErro(""); }}
                placeholder="Mínimo 6 caracteres"
                className="bg-background border-border pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setMostrar((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {mostrar ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Confirmar senha</Label>
            <Input
              type={mostrar ? "text" : "password"}
              value={confirmar}
              onChange={(e) => { setConfirmar(e.target.value); setErro(""); }}
              placeholder="Repita a nova senha"
              className="bg-background border-border"
              onKeyDown={(e) => e.key === "Enter" && handleSalvar()}
            />
          </div>

          {erro && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <XCircle className="h-3 w-3 shrink-0" />{erro}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando} className="border-border">
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando} className="gap-2">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Redefinir senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Painel de Formulário ──────────────────────────────────────────────────────
function PainelFormulario({
  usuario,
  index,
  total,
  onAnterior,
  onProximo,
  onSalvarAcesso,
  onExcluir,
  onResetarSenha,
  onAtualizado,
  salvando,
}: {
  usuario: Usuario;
  index: number;
  total: number;
  onAnterior: () => void;
  onProximo: () => void;
  onSalvarAcesso: (userId: string, moduleKey: string, hasAccess: boolean) => Promise<void>;
  onExcluir: (usuario: Usuario) => void;
  onResetarSenha: (usuario: Usuario) => void;
  onAtualizado: () => void;
  salvando: string | null;
}) {
  const { toast } = useToast();
  const inicial = { nome: usuario.nome ?? "", email: usuario.email ?? "", role: usuario.role };
  const [form, setForm] = useState(inicial);
  const [salvandoInfo, setSalvandoInfo] = useState(false);

  useEffect(() => {
    setForm({ nome: usuario.nome ?? "", email: usuario.email ?? "", role: usuario.role });
  }, [usuario.user_id]);

  const houveMudanca =
    form.nome !== (usuario.nome ?? "") ||
    form.email !== (usuario.email ?? "") ||
    form.role !== usuario.role;

  async function handleSalvarInfo() {
    setSalvandoInfo(true);
    try {
      const resp = await apiFetch(`/usuarios/${usuario.user_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) throw new Error(await lerErroApi(resp, "Erro ao salvar."));
      toast({ title: "Usuário atualizado", description: "Dados salvos com sucesso." });
      onAtualizado();
    } catch (err: any) {
      toast({
        title: "Erro ao salvar",
        description: normalizarErroBackend(err, "Erro ao salvar."),
        variant: "destructive",
      });
    }
    setSalvandoInfo(false);
  }

  const acessoMap = Object.fromEntries(
    usuario.user_module_access.map((a) => [a.module_key, a.has_access])
  );

  return (
    <motion.div
      key={usuario.user_id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.2 }}
      className="bg-card border border-border rounded-xl overflow-hidden shadow-[var(--shadow-sm)]"
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <AvatarUsuario usuario={usuario} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-foreground">{usuario.nome || "Sem nome"}</p>
              <BadgeRole role={usuario.role} />
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">{usuario.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onResetarSenha(usuario)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-primary/5 hover:border-primary/30 hover:text-primary text-muted-foreground text-[11px] font-medium transition-colors"
            title="Redefinir senha"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Redefinir senha
          </button>
          <button
            onClick={() => onExcluir(usuario)}
            className="p-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive text-muted-foreground transition-colors"
            title="Excluir usuário"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-5 bg-border" />
          <span className="text-[11px] text-muted-foreground font-mono">{index + 1} / {total}</span>
          <button
            onClick={onAnterior}
            disabled={index === 0}
            className="p-1.5 rounded-lg border border-border hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onProximo}
            disabled={index === total - 1}
            className="p-1.5 rounded-lg border border-border hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-abas */}
      <Tabs defaultValue="identificacao" className="w-full">
        <div className="border-b border-border px-5">
          <TabsList className="h-10 bg-transparent gap-0 p-0 rounded-none">
            <TabsTrigger
              value="identificacao"
              className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[12px] px-4 gap-1.5"
            >
              <User className="h-3.5 w-3.5" />
              Identificação
            </TabsTrigger>
            <TabsTrigger
              value="acessos"
              className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[12px] px-4 gap-1.5"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Acessos
              <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                {totalAcessos(usuario)}/{MODULOS.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Identificação */}
        <TabsContent value="identificacao" className="p-5 m-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Nome */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Nome completo
              </Label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={form.nome}
                  onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                  placeholder="Nome completo"
                  className="pl-8 bg-background border-border text-sm"
                />
              </div>
            </div>

            {/* E-mail */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="email@empresa.com"
                  className="pl-8 bg-background border-border text-sm font-mono"
                />
              </div>
            </div>

            {/* Tipo de acesso */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Tipo de acesso
              </Label>
              <div className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                form.role === "admin"
                  ? "bg-purple-500/5 border-purple-500/20"
                  : "bg-background border-border"
              }`}>
                <div className="flex items-center gap-2">
                  <Shield className={`h-3.5 w-3.5 shrink-0 ${form.role === "admin" ? "text-purple-600" : "text-muted-foreground"}`} />
                  <span className="text-sm text-foreground">
                    {form.role === "admin" ? "Administrador" : "Usuário comum"}
                  </span>
                </div>
                <Switch
                  checked={form.role === "admin"}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, role: v ? "admin" : "user" }))}
                />
              </div>
            </div>

            {/* Cadastrado em (readonly) */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Cadastrado em
              </Label>
              <div className="flex items-center gap-2 p-2.5 bg-muted/40 border border-border rounded-lg">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground">{formatarData(usuario.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Botão salvar — só aparece se houver mudança */}
          {houveMudanca && (
            <div className="mt-5 flex justify-end">
              <Button onClick={handleSalvarInfo} disabled={salvandoInfo} className="gap-2 h-8 text-xs">
                {salvandoInfo
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                Salvar alterações
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Tab: Acessos */}
        <TabsContent value="acessos" className="p-5 m-0">
          <p className="text-[12px] text-muted-foreground mb-3">
            Defina quais módulos este usuário pode acessar. As alterações são salvas imediatamente.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {MODULOS.map((mod) => {
              const ativo = acessoMap[mod.key] ?? false;
              const carregandoMod = salvando === `${usuario.user_id}:${mod.key}`;
              const Icon = mod.icon;

              return (
                <div
                  key={mod.key}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-all ${
                    ativo ? "bg-primary/5 border-primary/20" : "bg-background border-border"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      {carregandoMod
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Icon className="h-3.5 w-3.5" />
                      }
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[12px] font-medium truncate ${ativo ? "text-foreground" : "text-muted-foreground"}`}>
                        {mod.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 truncate">{mod.desc}</p>
                    </div>
                  </div>
                  <Switch
                    checked={ativo}
                    disabled={carregandoMod}
                    onCheckedChange={(v) => onSalvarAcesso(usuario.user_id, mod.key, v)}
                    className="shrink-0"
                  />
                </div>
              );
            })}
          </div>
        </TabsContent>

      </Tabs>
    </motion.div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Usuarios() {
  const { toast } = useToast();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroUsuario>("todos");
  const [modo, setModo] = useState<Modo>("grade");
  const [indexSelecionado, setIndexSelecionado] = useState(0);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [dialogNovo, setDialogNovo] = useState(false);
  const [excluindoUsuario, setExcluindoUsuario] = useState<Usuario | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [resetandoUsuario, setResetandoUsuario] = useState<Usuario | null>(null);

  // ── Carregar usuários ──
  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: perfis, error: erroPerfis }, { data: acessos, error: erroAcessos }] = await Promise.all([
      supabase.from("profiles").select("*").order("nome", { ascending: true }),
      supabase.from("user_module_access").select("user_id, module_key, has_access"),
    ]);

    if (erroPerfis || erroAcessos) {
      toast({
        title: "Erro ao carregar usuários",
        description: (erroPerfis || erroAcessos)?.message,
        variant: "destructive",
      });
      setCarregando(false);
      return;
    }

    const acessosPorUser: Record<string, AcessoModulo[]> = {};
    for (const a of acessos ?? []) {
      if (!acessosPorUser[a.user_id]) acessosPorUser[a.user_id] = [];
      acessosPorUser[a.user_id].push({ module_key: a.module_key, has_access: a.has_access });
    }

    const unidos = (perfis ?? []).map((p: any) => ({
      ...p,
      role: p.role ?? "user",
      user_module_access: acessosPorUser[p.user_id] ?? [],
    }));

    setUsuarios(unidos as Usuario[]);
    setCarregando(false);
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Filtros ──
  const usuariosFiltrados = usuarios.filter((u) => {
    const buscaAtende = !busca || [u.nome, u.email].some((valor) => valor?.toLowerCase().includes(busca.toLowerCase()));
    if (!buscaAtende) return false;
    if (filtroStatus === "ativos") return temAcessoAtivo(u);
    if (filtroStatus === "inativos") return !temAcessoAtivo(u);
    return true;
  });

  useEffect(() => {
    if (usuariosFiltrados.length === 0) {
      setIndexSelecionado(0);
      return;
    }
    setIndexSelecionado((atual) => Math.min(atual, usuariosFiltrados.length - 1));
  }, [usuariosFiltrados.length]);

  const usuarioAtual = usuariosFiltrados[indexSelecionado] ?? null;

  function abrirFormulario(i: number) {
    setIndexSelecionado(i);
    setModo("formulario");
  }

  function irPara(i: number) {
    setIndexSelecionado(Math.max(0, Math.min(usuariosFiltrados.length - 1, i)));
    if (usuariosFiltrados.length > 0) setModo("formulario");
  }

  // ── Salvar acesso ao módulo ──
  async function salvarAcesso(userId: string, moduleKey: string, hasAccess: boolean) {
    const chave = `${userId}:${moduleKey}`;
    setSalvando(chave);

    setUsuarios((prev) =>
      prev.map((u) => {
        if (u.user_id !== userId) return u;
        const existente = u.user_module_access.some((a) => a.module_key === moduleKey);
        return {
          ...u,
          user_module_access: existente
            ? u.user_module_access.map((a) =>
                a.module_key === moduleKey ? { ...a, has_access: hasAccess } : a
              )
            : [...u.user_module_access, { module_key: moduleKey, has_access: hasAccess }],
        };
      })
    );

    const { error } = await supabase
      .from("user_module_access")
      .upsert(
        { user_id: userId, module_key: moduleKey, has_access: hasAccess },
        { onConflict: "user_id,module_key" }
      );

    if (error) {
      toast({ title: "Erro ao salvar acesso", description: error.message, variant: "destructive" });
      carregar();
    }
    setSalvando(null);
  }

  // ── Excluir usuário ──
  async function confirmarExclusao() {
    if (!excluindoUsuario) return;
    setExcluindo(true);
    try {
      const { error } = await supabase.rpc("admin_delete_user", {
        target_user_id: excluindoUsuario.user_id,
      });
      if (error) {
        throw new Error(normalizarErroExclusaoUsuario(error.message));
      }
      toast({ title: "Usuário excluído", description: `${excluindoUsuario.nome || excluindoUsuario.email} foi removido.` });
      setModo("grade");
      setIndexSelecionado(0);
      carregar();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
    setExcluindo(false);
    setExcluindoUsuario(null);
  }

  // ── KPIs ──
  const total = usuarios.length;
  const admins = usuarios.filter((u) => u.role === "admin").length;
  const comAcesso = usuarios.filter(temAcessoAtivo).length;
  const filtrosBotoes: { key: FiltroUsuario; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "ativos", label: "Ativos" },
    { key: "inativos", label: "Inativos" },
  ];
  const idx = usuariosFiltrados.length > 0 ? Math.min(indexSelecionado, usuariosFiltrados.length - 1) : 0;
  const navDisabled = carregando || usuariosFiltrados.length === 0;

  return (
    <AppLayout
      title="Usuários"
      subtitle="Gestão de usuários e controle de acessos"
    >
      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Users}     label="Total de Usuários"  value={total}     color="bg-primary/10 text-primary"        delay={0} />
        <KpiCard icon={Shield}    label="Administradores"    value={admins}    color="bg-purple-500/10 text-purple-600"  delay={0.05} />
        <KpiCard icon={UserCheck} label="Com acesso ativo"   value={comAcesso} color="bg-green-500/10 text-green-600"   delay={0.1} />
      </div>

      {/* ── Busca ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="flex items-center gap-1 bg-card border border-border rounded-xl px-3 py-2.5 shadow-[var(--shadow-sm)]"
      >
        <div className="relative flex-1 max-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setIndexSelecionado(0); }}
            placeholder="Pesquisar..."
            className="pl-8 pr-8 h-8 bg-background border-border text-xs"
          />
          {busca && (
            <button onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center bg-background border border-border rounded-lg p-0.5 gap-0.5 shrink-0">
          {filtrosBotoes.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFiltroStatus(f.key); setIndexSelecionado(0); }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                filtroStatus === f.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-border mx-1 shrink-0" />

        <button
          onClick={() => setDialogNovo(true)}
          title="Novo usuário"
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
        </button>

        <button
          onClick={() => {
            if (modo === "formulario") setModo("grade");
            else if (usuariosFiltrados.length > 0) setModo("formulario");
          }}
          title={modo === "formulario" ? "Voltar para grade" : "Modo formulário"}
          className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors shrink-0 ${
            modo === "formulario"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <AlignJustify className="h-4 w-4" />
        </button>

        <div className="h-5 w-px bg-border mx-1 shrink-0" />

        {[
          { icon: ChevronsLeft, title: "Primeiro", action: () => irPara(0), disabled: navDisabled || idx <= 0 },
          { icon: ChevronLeft, title: "Anterior", action: () => irPara(idx - 1), disabled: navDisabled || idx <= 0 },
          { icon: ChevronRight, title: "Próximo", action: () => irPara(idx + 1), disabled: navDisabled || idx >= usuariosFiltrados.length - 1 },
          { icon: ChevronsRight, title: "Último", action: () => irPara(usuariosFiltrados.length - 1), disabled: navDisabled || idx >= usuariosFiltrados.length - 1 },
        ].map(({ icon: Icon, title, action, disabled }) => (
          <button
            key={title}
            onClick={action}
            disabled={disabled}
            title={title}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}

        <div className="h-5 w-px bg-border mx-1 shrink-0" />

        <button
          onClick={carregar}
          disabled={carregando}
          title="Atualizar"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
        </button>

        {modo === "formulario" && usuariosFiltrados.length > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono ml-1 shrink-0">
            {idx + 1} / {usuariosFiltrados.length}
          </span>
        )}
      </motion.div>

      {/* ── MODO GRADE ── */}
      {modo === "grade" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="bg-card border border-border rounded-xl overflow-hidden shadow-[var(--shadow-sm)]"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pl-5 w-10">#</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Usuário</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">E-mail</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Módulos ativos</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right pr-5">Acessos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregando ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : usuariosFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Users className="h-8 w-8 opacity-30" />
                        <p className="text-sm font-medium">Nenhum usuário encontrado.</p>
                        <Button variant="outline" size="sm" className="mt-1 border-border" onClick={() => setDialogNovo(true)}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Criar primeiro usuário
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <AnimatePresence initial={false}>
                    {usuariosFiltrados.map((u, i) => {
                      const qtd = totalAcessos(u);
                      return (
                        <motion.tr
                          key={u.user_id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: i * 0.02 }}
                          onClick={() => abrirFormulario(i)}
                          className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <TableCell className="pl-5 py-3.5">
                            <span className="text-[11px] font-mono text-muted-foreground">{i + 1}</span>
                          </TableCell>
                          <TableCell className="py-3.5">
                            <div className="flex items-center gap-2.5">
                              <AvatarUsuario usuario={u} size="sm" />
                              <span className="font-medium text-[13px] text-foreground">
                                {u.nome || <span className="text-muted-foreground italic text-xs">Sem nome</span>}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3.5">
                            <span className="font-mono text-[11px] text-muted-foreground">{u.email || "—"}</span>
                          </TableCell>
                          <TableCell className="py-3.5">
                            <BadgeRole role={u.role} />
                          </TableCell>
                          <TableCell className="py-3.5">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {u.user_module_access.filter((a) => a.has_access).slice(0, 3).map((a) => {
                                const mod = MODULOS.find((m) => m.key === a.module_key);
                                return (
                                  <Badge key={a.module_key} variant="outline" className="text-[10px] py-0 px-1.5 h-5 bg-primary/5 border-primary/20 text-primary">
                                    {mod?.label ?? a.module_key}
                                  </Badge>
                                );
                              })}
                              {u.user_module_access.filter((a) => a.has_access).length > 3 && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5 text-muted-foreground">
                                  +{u.user_module_access.filter((a) => a.has_access).length - 3}
                                </Badge>
                              )}
                              {qtd === 0 && <span className="text-[11px] text-muted-foreground italic">Sem acesso</span>}
                            </div>
                          </TableCell>
                          <TableCell className="py-3.5 pr-5">
                            <div className="flex justify-end">
                              <div className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                qtd > 0 ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
                              }`}>
                                {qtd > 0 ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                {qtd}/{MODULOS.length}
                              </div>
                            </div>
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                )}
              </TableBody>
            </Table>
          </div>

          {!carregando && usuariosFiltrados.length > 0 && (
            <div className="px-5 py-2.5 border-t border-border bg-muted/20">
              <span className="text-[11px] text-muted-foreground">
                {usuariosFiltrados.length} usuário{usuariosFiltrados.length !== 1 ? "s" : ""}
                {" · "}clique em uma linha para editar os acessos
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* ── MODO FORMULÁRIO ── */}
      {modo === "formulario" && (
        <>
          {carregando ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : usuarioAtual ? (
            <AnimatePresence mode="wait">
              <PainelFormulario
                key={usuarioAtual.user_id}
                usuario={usuarioAtual}
                index={indexSelecionado}
                total={usuariosFiltrados.length}
                onAnterior={() => setIndexSelecionado((i) => Math.max(0, i - 1))}
                onProximo={() => setIndexSelecionado((i) => Math.min(usuariosFiltrados.length - 1, i + 1))}
                onSalvarAcesso={salvarAcesso}
                onExcluir={setExcluindoUsuario}
                onResetarSenha={setResetandoUsuario}
                onAtualizado={carregar}
                salvando={salvando}
              />
            </AnimatePresence>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum usuário encontrado.</p>
            </div>
          )}
        </>
      )}

      {/* ── Diálogos ── */}
      <DialogNovoUsuario
        aberto={dialogNovo}
        onClose={() => setDialogNovo(false)}
        onCriado={() => { carregar(); setModo("grade"); }}
      />

      <DialogResetSenha
        usuario={resetandoUsuario}
        aberto={!!resetandoUsuario}
        onClose={() => setResetandoUsuario(null)}
      />

      <AlertDialog open={!!excluindoUsuario} onOpenChange={(v) => !v && setExcluindoUsuario(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Excluir usuário
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir{" "}
              <span className="font-semibold text-foreground">
                {excluindoUsuario?.nome || excluindoUsuario?.email}
              </span>
              ? Esta ação remove o acesso ao sistema e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border" disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarExclusao}
              disabled={excluindo}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
