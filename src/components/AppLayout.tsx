import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  PanelsTopLeft,
  Send,
  Settings,
  ShieldCheck,
  UserCircle2,
  LineChart,
  type LucideIcon,
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatBrasiliaDate, formatBrasiliaTime } from "@/lib/brasilia-time";
import { fetchServerClock } from "@/services/api";
import { cn } from "@/lib/utils";

type NavigationItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  /** Chave do módulo em user_module_access. Undefined = sempre visível (ex: Dashboard). */
  moduleKey?: string;
};

type NavigationSection = {
  icon: LucideIcon;
  id: string;
  items: NavigationItem[];
  label: string;
};

const navigationSections: NavigationSection[] = [
  {
    id: "overview",
    label: "Visão Geral",
    icon: PanelsTopLeft,
    items: [
      {
        label: "Dashboard",
        description: "Indicadores e panorama da operação",
        icon: LayoutDashboard,
        href: "/",
        // sem moduleKey — Dashboard sempre visível
      },
    ],
  },
  {
    id: "operations",
    label: "Operação",
    icon: ClipboardList,
    items: [
      {
        label: "Controle de OS",
        description: "Solicite, acompanhe e dispare o apontamento das ordens de serviço",
        icon: ClipboardList,
        href: "/lancamento-os",
        moduleKey: "lancamento_os",
      },
      {
        label: "Relatórios",
        description: "Análise de horas por período, cliente e consultor",
        icon: LineChart,
        href: "/relatorios",
        moduleKey: "relatorios",
      },
      {
        label: "Saldo de Horas",
        description: "Leituras e validações de apontamento",
        icon: CalendarDays,
        href: "/saldo-horas",
        moduleKey: "saldo_horas",
      },
      {
        label: "Status Report",
        description: "Acompanhamento e análise operacional",
        icon: BarChart3,
        href: "/status-report",
        moduleKey: "status_report",
      },
    ],
  },
  {
    id: "automation",
    label: "Automação",
    icon: Bot,
    items: [
      {
        label: "Abertura Automática OS",
        description: "RPA executa a abertura das OS solicitadas",
        icon: Bot,
        href: "/automacao-os",
        moduleKey: "automacao_os",
      },
      {
        label: "Rotinas",
        description: "Agendamentos e tarefas programadas",
        icon: CalendarClock,
        href: "/rotinas",
        moduleKey: "automacao_os",
      },
      {
        label: "Histórico de Envios",
        description: "Rastreamento de filas e disparos",
        icon: Send,
        href: "/envios",
        moduleKey: "status_report",
      },
      {
        label: "Modelos de Email",
        description: "Templates padronizados de comunicação",
        icon: Mail,
        href: "/modelos-email",
        moduleKey: "modelos",
      },
    ],
  },
  {
    id: "registry",
    label: "Cadastros",
    icon: Building2,
    items: [
      {
        label: "Clientes",
        description: "Empresas e vínculos atendidos",
        icon: Building2,
        href: "/clientes",
        moduleKey: "clientes",
      },
      {
        label: "Usuários",
        description: "Perfis, acessos e responsáveis",
        icon: UserCircle2,
        href: "/usuarios",
        moduleKey: "usuarios",
      },
    ],
  },
  {
    id: "system",
    label: "Sistema",
    icon: Settings,
    items: [
      {
        label: "Painel Admin",
        description: "Parâmetros internos e administração",
        icon: ShieldCheck,
        href: "/admin",
        moduleKey: "admin",
      },
    ],
  },
];

const totalModules = navigationSections.reduce((sum, section) => sum + section.items.length, 0);

function filterSections(isAdmin: boolean, moduleAccess: Set<string>): NavigationSection[] {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.moduleKey || isAdmin || moduleAccess.has(item.moduleKey),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

const getDefaultOpenSections = (pathname: string) =>
  navigationSections.reduce<Record<string, boolean>>((acc, section, index) => {
    acc[section.id] = index === 0 || section.items.some((item) => item.href === pathname);
    return acc;
  }, {});

const formatNameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");

const resolveUserName = (profileName?: string | null, metadataName?: unknown, email?: string | null) => {
  if (typeof profileName === "string" && profileName.trim()) return profileName.trim();
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  if (email) return formatNameFromEmail(email);
  return "Equipe ELLA";
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part.charAt(0)).join("");
  return initials.toUpperCase() || "EA";
};

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle: string;
  headerExtra?: ReactNode;
}

interface SidebarNavItemProps {
  collapsed: boolean;
  item: NavigationItem;
}

interface SidebarSectionProps {
  activePath: string;
  collapsed: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  section: NavigationSection;
}

interface UserAccountMenuProps {
  avatarUrl: string | null;
  dateLabel: string;
  email: string;
  isAdmin: boolean;
  name: string;
  onAdminNavigate: () => void;
  onSignOut: () => void;
  roleLabel: string;
}

function SidebarNavItem({ collapsed, item }: SidebarNavItemProps) {
  const link = (
    <NavLink
      to={item.href}
      end
      className={cn(
        "group/nav-item flex w-full transition-all duration-200",
        collapsed
          ? "items-center justify-center rounded-2xl px-1 py-1 text-sidebar-foreground/70 hover:text-sidebar-primary"
          : "items-center rounded-xl px-3 py-2 pl-8 text-[12px] font-medium text-sidebar-foreground/78 hover:bg-sidebar-accent/45 hover:text-sidebar-primary",
      )}
      activeClassName={cn(
        collapsed
          ? "text-sidebar-primary [&_.nav-item-icon]:border-sidebar-primary/25 [&_.nav-item-icon]:bg-sidebar-primary [&_.nav-item-icon]:text-sidebar-primary-foreground [&_.nav-item-icon]:shadow-[0_4px_12px_-4px_rgba(32,109,57,0.45)]"
          : "bg-sidebar-accent/75 text-sidebar-primary",
        !collapsed && "[&_.nav-item-dot]:bg-sidebar-primary [&_.nav-item-label]:text-sidebar-primary",
      )}
    >
      {collapsed ? (
        <span className="nav-item-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sidebar-border/50 bg-sidebar/80 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all duration-200 group-hover/nav-item:border-sidebar-primary/20 group-hover/nav-item:bg-sidebar-accent/80 group-hover/nav-item:shadow-[0_3px_10px_-3px_rgba(32,109,57,0.18)]">
          <item.icon className="h-[18px] w-[18px]" />
        </span>
      ) : (
        <span className="relative min-w-0 flex-1">
          <span className="nav-item-dot absolute left-[-12px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-sidebar-foreground/28 transition-colors" />
          <span className="nav-item-label block truncate">{item.label}</span>
        </span>
      )}
    </NavLink>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" align="center" className="rounded-xl border-border bg-card px-3 py-2 text-[12px]">
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarSection({ activePath, collapsed, onOpenChange, open, section }: SidebarSectionProps) {
  const hasActiveItem = section.items.some((item) => item.href === activePath);

  if (collapsed) {
    return (
      <SidebarGroup className="px-1 py-1">
        <SidebarMenu className="gap-0.5">
          {section.items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarNavItem collapsed item={item} />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <SidebarGroup className="px-2.5 py-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all duration-200",
              hasActiveItem
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/72 hover:bg-sidebar-accent/35 hover:text-sidebar-primary",
            )}
          >
            <section.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.16em]">
              {section.label}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <SidebarMenu className="mt-1 gap-0.5 border-l border-sidebar-border/80 pl-1.5">
            {section.items.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarNavItem collapsed={false} item={item} />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function AppSidebar() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isAdmin, moduleAccess } = useAuth();

  const visibleSections = filterSections(isAdmin, moduleAccess);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    getDefaultOpenSections(location.pathname),
  );

  useEffect(() => {
    setOpenSections((current) => {
      const next = { ...current };
      let changed = false;

      visibleSections.forEach((section, index) => {
        if (!(section.id in next)) {
          next[section.id] = index === 0;
          changed = true;
        }

        if (section.items.some((item) => item.href === location.pathname) && !next[section.id]) {
          next[section.id] = true;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [location.pathname, visibleSections]);

  const visibleCount = visibleSections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/90 bg-sidebar/95">
      <div className="border-b border-sidebar-border/80 px-3 py-3">
        <div className={cn("flex", collapsed ? "flex-col items-center gap-2" : "items-start justify-between gap-3")}>
          <div className={cn("flex min-w-0", collapsed ? "flex-col items-center gap-2" : "items-center gap-3")}>
            <div
              className={cn(
                "shrink-0 overflow-hidden rounded-2xl border border-sidebar-border/70 bg-white shadow-[0_14px_30px_-20px_rgba(32,109,57,0.45)]",
                collapsed ? "h-11 w-11" : "h-14 w-14",
              )}
            >
              <img
                src="/Ella_perfil.png"
                alt="Perfil da ELLA"
                className="h-full w-full object-cover object-top"
              />
            </div>

          {!collapsed && (
            <div className="min-w-0">
              <strong className="block text-[14px] font-bold tracking-tight text-sidebar-primary">ELLA SO</strong>
              <span className="block text-[10px] leading-4 text-sidebar-foreground/62">Central de operação</span>
            </div>
          )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 rounded-full border border-sidebar-border/80 bg-sidebar-accent/50 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
            aria-label={isMobile ? "Fechar menu lateral" : collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            title={isMobile ? "Fechar menu lateral" : collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <SidebarContent className="gap-0 px-0 py-2">
        {visibleSections.map((section, index) => (
          <div key={section.id}>
            {collapsed && index > 0 && (
              <div className="mx-auto my-1 h-px w-7 rounded-full bg-sidebar-border/60" />
            )}
            <SidebarSection
              activePath={location.pathname}
              collapsed={collapsed}
              onOpenChange={(open) => setOpenSections((current) => ({ ...current, [section.id]: open }))}
              open={openSections[section.id] ?? false}
              section={section}
            />
          </div>
        ))}
      </SidebarContent>

      {!collapsed && (
        <div className="border-t border-sidebar-border/80 px-3 py-2.5 text-[10px] text-sidebar-foreground/56">
          <div className="flex items-center justify-between">
            <span>{visibleCount} módulos</span>
            <span className="font-mono">v1.0</span>
          </div>
        </div>
      )}
    </Sidebar>
  );
}

function UserAccountMenu({
  avatarUrl,
  dateLabel,
  email,
  isAdmin,
  name,
  onAdminNavigate,
  onSignOut,
  roleLabel,
}: UserAccountMenuProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const initials = getInitials(name);

  // Photo upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [photoDlgOpen, setPhotoDlgOpen] = useState(false);
  const [ajudaDlgOpen, setAjudaDlgOpen] = useState(false);

  // Alterar senha state
  const [senhaDlgOpen, setSenhaDlgOpen] = useState(false);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarNova, setMostrarNova] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [senhaLoading, setSenhaLoading] = useState(false);

  const handleAlterarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setSenhaLoading(true);
    try {
      const token = (await import("@/integrations/supabase/client"))
        .supabase.auth.getSession().then(r => r.data.session?.access_token ?? "");
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:8000"}/auth/alterar-senha`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token}` },
          body: JSON.stringify({ nova_senha: novaSenha, confirmar_senha: confirmarSenha }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Erro", description: data.detail || "Erro ao alterar senha.", variant: "destructive" });
      } else {
        toast({ title: "Senha atualizada com sucesso!" });
        setSenhaDlgOpen(false);
        setNovaSenha("");
        setConfirmarSenha("");
      }
    } catch {
      toast({ title: "Erro de conexão", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setSenhaLoading(false);
    }
  };
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(avatarUrl);
  const resolvedAvatarSrc = localAvatarUrl?.trim() ? localAvatarUrl : "/perfil.png";

  // Keep in sync if parent prop changes
  useEffect(() => { setLocalAvatarUrl(avatarUrl); }, [avatarUrl]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImgSrc(ev.target?.result as string);
      setZoom(1);
      setPhotoDlgOpen(true);
    };
    reader.readAsDataURL(file);
    // reset input so same file can be reselected
    e.target.value = "";
  }, []);

  const drawCanvas = useCallback(() => {
    if (!imgSrc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      ctx.clearRect(0, 0, size, size);
      // Draw circular clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      const scale = zoom;
      const sw = img.width / scale;
      const sh = img.height / scale;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      ctx.restore();
    };
    img.src = imgSrc;
  }, [imgSrc, zoom]);

  useEffect(() => {
    if (!photoDlgOpen || !imgSrc) return;

    let frameA = 0;
    let frameB = 0;

    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(() => {
        drawCanvas();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [drawCanvas, imgSrc, photoDlgOpen, zoom]);

  const handleUpload = useCallback(async () => {
    if (!canvasRef.current || !user) return;
    setUploading(true);
    try {
      // Persist the cropped image directly in user metadata so the feature works
      // even when the project has no Supabase Storage bucket configured.
      const avatarDataUrl = canvasRef.current.toDataURL("image/jpeg", 0.88);
      const { error: metaErr } = await supabase.auth.updateUser({ data: { avatar_url: avatarDataUrl } });
      if (metaErr) throw metaErr;
      setLocalAvatarUrl(avatarDataUrl);
      setPhotoDlgOpen(false);
      setImgSrc(null);
      toast({ title: "Foto atualizada com sucesso!" });
    } catch (err: unknown) {
      toast({ title: "Erro ao enviar foto", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [user, toast]);

  return (
    <>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {/* Photo crop dialog */}
      <Dialog open={photoDlgOpen} onOpenChange={setPhotoDlgOpen}>
        <DialogContent forceMount className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Ajustar foto de perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="overflow-hidden rounded-full border-4 border-primary/20 shadow-lg" style={{ width: 200, height: 200 }}>
              <canvas ref={canvasRef} width={200} height={200} className="block" />
            </div>
            <div className="w-full px-2">
              <p className="mb-2 text-center text-[11px] text-muted-foreground">Zoom</p>
              <Slider
                min={1}
                max={4}
                step={0.05}
                value={[zoom]}
                onValueChange={([v]) => setZoom(v)}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setPhotoDlgOpen(false); setImgSrc(null); }}>Cancelar</Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Enviando…" : "Salvar foto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ajuda dialog */}
      <Dialog open={ajudaDlgOpen} onOpenChange={setAjudaDlgOpen}>
        <DialogContent className="max-w-lg rounded-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Central de Ajuda — ELLA SO</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2 text-[13px] leading-relaxed text-foreground/80">
            <div>
              <h4 className="mb-1.5 font-semibold text-foreground">Sobre o sistema</h4>
              <p>O ELLA SO é a central de operação da equipe Sankhya. Ele centraliza o apontamento de OS, automação de rotinas via RPA, relatórios analíticos e envio de Status Reports aos clientes.</p>
            </div>
            <div>
              <h4 className="mb-1.5 font-semibold text-foreground">Rotina do consultor</h4>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Acesse <strong>Lançamento de OS</strong> e registre as horas executadas do dia.</li>
                <li>Confira o <strong>Saldo de Horas</strong> para garantir que está dentro do previsto.</li>
                <li>Acompanhe os <strong>Relatórios</strong> para visualizar seu histórico de apontamentos.</li>
                <li>Verifique notificações de erros na abertura automática de OS em <strong>Automação OS</strong>.</li>
              </ol>
            </div>
            <div>
              <h4 className="mb-1.5 font-semibold text-foreground">Rotina do administrador</h4>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Configure as <strong>Rotinas</strong> de automação (horários, recorrência) em Automação → Rotinas.</li>
                <li>Gerencie os <strong>Modelos de E-mail</strong> para Status Report dos clientes.</li>
                <li>Acompanhe os <strong>Envios</strong> realizados e pendentes.</li>
                <li>Use <strong>Relatórios</strong> para monitorar produtividade da equipe por período, cliente e consultor.</li>
                <li>Gerencie <strong>Usuários</strong> e defina quais módulos cada um pode acessar.</li>
              </ol>
            </div>
            <div>
              <h4 className="mb-1.5 font-semibold text-foreground">Boas práticas</h4>
              <ul className="list-disc space-y-1 pl-4">
                <li>Atualize o status das OS diariamente para manter o painel preciso.</li>
                <li>Evite deixar OS com status "Aguardando RPA" sem revisão por mais de 1 dia.</li>
                <li>Revise o Status Report antes do envio automático.</li>
              </ul>
            </div>
            <div className="rounded-2xl bg-primary/5 px-4 py-3">
              <p className="text-[12px]">Dúvidas não resolvidas aqui? Envie um e-mail para <a href="mailto:pedro.trindade@sankhya.com.br" className="font-semibold text-primary underline">pedro.trindade@sankhya.com.br</a></p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Alterar senha dialog */}
      <Dialog open={senhaDlgOpen} onOpenChange={(open) => { setSenhaDlgOpen(open); if (!open) { setNovaSenha(""); setConfirmarSenha(""); } }}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> Alterar senha
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAlterarSenha} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nova senha</label>
              <div className="relative">
                <input
                  type={mostrarNova ? "text" : "password"}
                  value={novaSenha}
                  onChange={e => setNovaSenha(e.target.value)}
                  required minLength={8}
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                  placeholder="Min. 8 chars, maiúsc., número e especial"
                />
                <button type="button" onClick={() => setMostrarNova(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {mostrarNova ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confirmar nova senha</label>
              <div className="relative">
                <input
                  type={mostrarConfirmar ? "text" : "password"}
                  value={confirmarSenha}
                  onChange={e => setConfirmarSenha(e.target.value)}
                  required minLength={8}
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                  placeholder="Repita a nova senha"
                />
                <button type="button" onClick={() => setMostrarConfirmar(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {mostrarConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Mín. 8 caracteres · 1 maiúscula · 1 número · 1 especial (!@#$%&*)</p>
            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setSenhaDlgOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={senhaLoading}>
                {senhaLoading ? "Salvando…" : "Salvar senha"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex items-center gap-3 rounded-full border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,248,244,0.92))] px-2 py-1.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.42)] transition-all hover:border-primary/25 hover:shadow-[0_18px_36px_-24px_rgba(32,109,57,0.32)]"
          >
            <div className="hidden min-w-0 md:flex flex-col items-end leading-tight">
              <span className="max-w-[160px] truncate text-[11px] font-semibold text-foreground">{name}</span>
              <span className="text-[10px] text-muted-foreground">{roleLabel}</span>
            </div>

            <div className="relative shrink-0">
              <Avatar className="h-10 w-10 border border-primary/10 bg-white ring-2 ring-primary/10 shadow-[0_12px_24px_-18px_rgba(32,109,57,0.5)]">
                <AvatarImage src={resolvedAvatarSrc} alt={name} className="object-cover" />
                <AvatarFallback className="bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_52%),linear-gradient(135deg,hsl(var(--primary)),hsl(var(--green-mid)))] text-[13px] font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-primary shadow-sm" />
            </div>

            <ChevronsUpDown className="hidden h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground sm:block" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={12}
          className="w-80 max-w-[calc(100vw-1rem)] rounded-[24px] border-border/80 bg-popover/95 p-0 shadow-[0_28px_70px_-34px_rgba(15,23,42,0.42)] backdrop-blur-xl sm:w-[340px]"
        >
          <div className="border-b border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(240,248,242,0.95))] px-5 py-5">
            <div className="flex gap-4">
              <button
                type="button"
                className="group/avatar relative shrink-0"
                onClick={() => fileInputRef.current?.click()}
                title="Clique para alterar foto"
              >
                <Avatar className="h-20 w-20 border border-primary/10 bg-white ring-4 ring-primary/10 shadow-[0_18px_38px_-22px_rgba(32,109,57,0.7)]">
                  <AvatarImage src={resolvedAvatarSrc} alt={name} className="object-cover" />
                  <AvatarFallback className="bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%),linear-gradient(135deg,hsl(var(--primary)),hsl(var(--green-mid)))] text-2xl font-semibold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover/avatar:opacity-100">
                  <UserCircle2 className="h-6 w-6 text-white" />
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[20px] font-bold tracking-tight text-foreground">{name}</h3>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{roleLabel}</p>
                  </div>

                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                    Online
                  </span>
                </div>

                <p className="mt-3 truncate text-[12px] text-muted-foreground">{email}</p>

                <div className="mt-4 flex items-center gap-2">
                  <div className="flex flex-col text-[11px] leading-4 text-muted-foreground">
                    <span className="font-medium text-foreground/82">Versão</span>
                    <span>ELLA 4.0</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-background/92 px-3 py-2 text-[11px] text-muted-foreground">
              <span>Última visualização</span>
              <span className="font-mono">{dateLabel}</span>
            </div>
          </div>

          <div className="p-2">
            <DropdownMenuItem
              className="h-11 rounded-2xl px-3 text-[13px]"
              onSelect={(event) => {
                event.preventDefault();
                fileInputRef.current?.click();
              }}
            >
              <UserCircle2 className="mr-3 h-4 w-4 text-primary" />
              <span className="flex-1">Alterar foto</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="h-11 rounded-2xl px-3 text-[13px]"
              onSelect={(event) => {
                event.preventDefault();
                setSenhaDlgOpen(true);
              }}
            >
              <KeyRound className="mr-3 h-4 w-4 text-primary" />
              <span className="flex-1">Alterar senha</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="h-11 rounded-2xl px-3 text-[13px]"
              onSelect={(event) => {
                event.preventDefault();
                setAjudaDlgOpen(true);
              }}
            >
              <HelpCircle className="mr-3 h-4 w-4 text-primary" />
              <span className="flex-1">Ajuda</span>
            </DropdownMenuItem>

            {isAdmin && (
              <DropdownMenuItem
                className="h-11 rounded-2xl px-3 text-[13px]"
                onSelect={(event) => {
                  event.preventDefault();
                  onAdminNavigate();
                }}
              >
                <ShieldCheck className="mr-3 h-4 w-4 text-primary" />
                <span className="flex-1">Administração</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Ativo</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator className="my-2 bg-border/80" />

            <DropdownMenuItem
              className="h-11 rounded-2xl px-3 text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                onSignOut();
              }}
            >
              <LogOut className="mr-3 h-4 w-4" />
              <span className="flex-1">Sair</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export default function AppLayout({ children, title, subtitle, headerExtra }: AppLayoutProps) {
  const { profile, session, signOut, user, loading } = useAuth();
  const navigate = useNavigate();
  const [clockSync, setClockSync] = useState<{ baseMs: number; perfMs: number } | null>(null);
  const [clockStatus, setClockStatus] = useState("Sincronizando BRT");
  const [, setClockBeat] = useState(0);

  const sincronizarRelogio = useCallback(async () => {
    try {
      const clock = await fetchServerClock();
      if (!Number.isFinite(clock.currentTimeMs) || clock.currentTimeMs <= 0) {
        throw new Error("Backend retornou um horario invalido.");
      }

      setClockSync({
        baseMs: clock.currentTimeMs,
        perfMs: performance.now(),
      });
      setClockStatus("BRT");
    } catch (error) {
      console.error("Falha ao sincronizar relogio do backend:", error);
      setClockSync(null);
      setClockStatus("BRT local");
    }
  }, []);

  useEffect(() => {
    if (loading || !session) return;

    void sincronizarRelogio();

    const resyncTimer = window.setInterval(() => {
      void sincronizarRelogio();
    }, 60000);

    return () => window.clearInterval(resyncTimer);
  }, [loading, session, sincronizarRelogio]);

  useEffect(() => {
    const tickTimer = window.setInterval(() => {
      setClockBeat((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(tickTimer);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const serverNow = clockSync
    ? new Date(clockSync.baseMs + (performance.now() - clockSync.perfMs))
    : new Date();
  const currentDateLabel = formatBrasiliaDate(serverNow);
  const currentTimeLabel = formatBrasiliaTime(serverNow, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const currentDateTimeLabel = serverNow
    ? `${currentDateLabel} · ${currentTimeLabel} ${clockStatus}`
    : clockStatus;

  const userName = resolveUserName(profile?.nome, user?.user_metadata?.nome, user?.email);
  const userEmail = user?.email ?? "operacao@sankhya.com.br";
  const roleLabel = profile?.role === "admin" ? "Administrador do sistema" : "Equipe operacional";

  // Modal forçado de troca de senha temporária
  const [forceSenha, setForceSenha] = useState("");
  const [forceConfirmar, setForceConfirmar] = useState("");
  const [forceMostrarNova, setForceMostrarNova] = useState(false);
  const [forceMostrarConf, setForceMostrarConf] = useState(false);
  const [forceLoading, setForceLoading] = useState(false);
  const { toast: forceToast } = useToast();

  const handleForceSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setForceLoading(true);
    try {
      const { supabase: sb } = await import("@/integrations/supabase/client");
      const token = (await sb.auth.getSession()).data.session?.access_token ?? "";
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:8000"}/auth/alterar-senha`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nova_senha: forceSenha, confirmar_senha: forceConfirmar }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        forceToast({ title: "Erro", description: data.detail || "Erro ao alterar senha.", variant: "destructive" });
      } else {
        forceToast({ title: "Senha atualizada com sucesso!" });
        setForceSenha("");
        setForceConfirmar("");
        // Recarrega o perfil atualizando o estado via supabase
        const { supabase: sb2 } = await import("@/integrations/supabase/client");
        await sb2.auth.refreshSession();
      }
    } catch {
      forceToast({ title: "Erro de conexão", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setForceLoading(false);
    }
  };

  return (
    <SidebarProvider>
      {/* Modal forçado — senha temporária */}
      {profile?.senha_temporaria && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Defina sua senha pessoal</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Você recebeu uma senha temporária. Crie uma senha própria para continuar.</p>
              </div>
            </div>
            <form onSubmit={handleForceSenha} className="space-y-3">
              <div className="relative">
                <input type={forceMostrarNova ? "text" : "password"} value={forceSenha} onChange={e => setForceSenha(e.target.value)}
                  required minLength={8} placeholder="Nova senha"
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
                <button type="button" onClick={() => setForceMostrarNova(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {forceMostrarNova ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative">
                <input type={forceMostrarConf ? "text" : "password"} value={forceConfirmar} onChange={e => setForceConfirmar(e.target.value)}
                  required minLength={8} placeholder="Confirmar nova senha"
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
                <button type="button" onClick={() => setForceMostrarConf(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {forceMostrarConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">Mín. 8 chars · 1 maiúscula · 1 número · 1 especial (!@#$%&*)</p>
              <Button type="submit" disabled={forceLoading} className="w-full">
                {forceLoading ? "Salvando…" : <><CheckCircle2 className="h-4 w-4 mr-2" />Definir minha senha</>}
              </Button>
            </form>
          </div>
        </div>
      )}

      <div className="flex min-h-screen w-full bg-background text-sm text-foreground">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-[58px] shrink-0 items-center justify-between border-b border-border bg-card/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <SidebarTrigger className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground md:hidden" />

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse-dot" />
                  <h2 className="truncate text-[13px] font-semibold text-foreground sm:text-sm">{title}</h2>
                </div>
                <span className="hidden truncate text-[10px] text-muted-foreground sm:block">{subtitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {headerExtra}

              <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] text-muted-foreground shadow-[var(--shadow-sm)] xl:flex">
                <CalendarClock className="h-3 w-3 text-primary" />
                <span>{currentDateLabel}</span>
                <span className="font-mono text-foreground/80">{currentTimeLabel} {clockStatus}</span>
              </div>

              <UserAccountMenu
                avatarUrl={user?.user_metadata?.avatar_url ?? null}
                dateLabel={currentDateTimeLabel}
                email={userEmail}
                isAdmin={profile?.role === "admin"}
                name={userName}
                onAdminNavigate={() => navigate("/admin")}
                onSignOut={() => {
                  void handleSignOut();
                }}
                roleLabel={roleLabel}
              />
            </div>
          </header>

          <main className="flex flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:p-5">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
