import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { notifySchedulerUpdated } from "@/services/api";
import {
  Building2, Plus, Search, Trash2, Loader2,
  CheckCircle2, XCircle, Users, UserCheck, UserX, X,
  FileText, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CalendarDays, Lock, User, Eye, EyeOff, Save, Bot, Clock, Link2,
  CalendarClock, Mail, Send, Zap, AlignJustify, RefreshCw, TrendingUp,
  ClipboardCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Definição dos links por funcionalidade ────────────────────────────────────
const LINK_DEFS = [
  {
    campo:     "url_abertura_os" as const,
    titulo:    "Abertura de OS",
    descricao: "URL usada pelo robô Python para abrir ordens de serviço na FAP",
    icon:      Bot,
    cor:       "text-primary bg-primary/10 border-primary/20",
    corIcon:   "text-primary",
  },
  {
    campo:     "url_saldo_horas" as const,
    titulo:    "Consulta de Saldo de Horas",
    descricao: "URL usada pela tela Saldo de Horas para consultar o saldo do cliente",
    icon:      Clock,
    cor:       "text-blue-700 bg-blue/8 border-blue/20",
    corIcon:   "text-blue-600",
  },
  {
    campo:     "url_tarefas" as const,
    titulo:    "Apontamento em Tarefas",
    descricao: "URL da tela de Tarefas usada pelo gatilho de apontamento do Controle de OS",
    icon:      ClipboardCheck,
    cor:       "text-violet-700 bg-violet-500/8 border-violet-500/20",
    corIcon:   "text-violet-600",
  },
] as const;

type CampoLink = typeof LINK_DEFS[number]["campo"];

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Cliente {
  id: string;
  nome: string;
  cnpj: string;
  ativo: boolean;
  sustentacao_desde: string | null;
  status_sustentacao: string;
  criado_em: string;
  atualizado_em: string;
}

interface ConfigCliente {
  id?: string;
  cliente_id: string;
  exp_usuario: string;
  exp_senha: string;
  url_abertura_os: string;
  url_saldo_horas: string;
  url_tarefas: string;
  obs: string;
}

const CONFIG_VAZIA: Omit<ConfigCliente, "cliente_id"> = {
  exp_usuario: "",
  exp_senha: "",
  url_abertura_os: "",
  url_saldo_horas: "",
  url_tarefas: "",
  obs: "",
};

function normalizarConfigCliente(config: ConfigCliente | null | undefined): Omit<ConfigCliente, "cliente_id"> {
  if (!config) return { ...CONFIG_VAZIA };

  return {
    exp_usuario: config.exp_usuario ?? "",
    exp_senha: config.exp_senha ?? "",
    url_abertura_os: config.url_abertura_os ?? "",
    url_saldo_horas: config.url_saldo_horas ?? "",
    url_tarefas: config.url_tarefas ?? "",
    obs: config.obs ?? "",
  };
}

type FiltroStatus = "todos" | "ativos" | "inativos";
type Modo = "lista" | "formulario";

// ── Tipos Automação ────────────────────────────────────────────────────────────
interface ModeloEmail {
  id: number;
  assunto: string;
}

interface StatusReportConfig {
  id: string;
  cliente_id: string;
  modelo_id: number | null;
  fap: string | null;
  periodo: "semanal" | "quinzenal" | "mensal";
  dia_envio: number;
  enviar_sem_os: boolean;
  ativo: boolean;
}

interface SrDestinatario {
  id: string;
  email: string;
  ativo: boolean;
}

const SR_FORM_VAZIO = {
  modelo_id: null as number | null,
  fap: "",
  periodo: "mensal" as "semanal" | "quinzenal" | "mensal",
  dia_envio: 1,
  enviar_sem_os: false,
  ativo: true,
};

interface ContratoHoras {
  id: string;
  cliente_id: string;
  horas_mensais: number;
  vigente_de: string;
  criado_em: string;
  observacao: string | null;
}

const SR_DIA_ENVIO_HINT: Record<StatusReportConfig["periodo"], string> = {
  semanal: "Use 0 a 6 (0=Seg, 6=Dom)",
  quinzenal: "Dia base da quinzena (1 a 28)",
  mensal: "Dia do mês (1 a 28)",
};

// ── Utilitários ───────────────────────────────────────────────────────────────
function mascaraCNPJ(v: string): string {
  v = v.replace(/\D/g, "").slice(0, 14);
  if (v.length > 12) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, "$1.$2.$3/$4-$5");
  if (v.length > 8)  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})$/, "$1.$2.$3/$4");
  if (v.length > 5)  return v.replace(/^(\d{2})(\d{3})(\d{0,3})$/, "$1.$2.$3");
  if (v.length > 2)  return v.replace(/^(\d{2})(\d{0,3})$/, "$1.$2");
  return v;
}

function validarCNPJ(cnpj: string): boolean {
  const nums = cnpj.replace(/\D/g, "");
  if (nums.length !== 14) return false;
  if (/^(\d)\1+$/.test(nums)) return false;
  const calc = (n: number) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = n; i >= 1; i--) {
      soma += parseInt(nums[n - i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(nums[12]) && calc(13) === parseInt(nums[13]);
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatarMesAno(dateStr: string): string {
  if (!dateStr) return "—";
  const [ano, mes] = dateStr.split("-");
  return `${mes}/${ano}`;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, delay }: {
  icon: React.ElementType; label: string; value: number; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
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

// ── Painel Formulário ─────────────────────────────────────────────────────────
function PainelFormulario({
  cliente,
  isNovo,
  configAtual,
  onSalvoCliente,
  onExcluir,
}: {
  cliente: Cliente;
  isNovo: boolean;
  configAtual: ConfigCliente | null;
  onSalvoCliente: (c: Cliente) => void;
  onExcluir: (c: Cliente) => void;
}) {
  const { toast } = useToast();

  // ── Tab: Identificação ──
  const [idForm, setIdForm] = useState({
    nome: cliente.nome,
    cnpj: cliente.cnpj,
    ativo: cliente.ativo,
    sustentacao_desde: cliente.sustentacao_desde ?? "",
    status_sustentacao: cliente.status_sustentacao ?? "ativo",
  });
  const idDirty =
    idForm.nome !== cliente.nome ||
    idForm.cnpj !== cliente.cnpj ||
    idForm.ativo !== cliente.ativo;

  const sustDirty =
    idForm.sustentacao_desde !== (cliente.sustentacao_desde ?? "") ||
    idForm.status_sustentacao !== (cliente.status_sustentacao ?? "ativo");

  // ── Tab: Configurações ──
  const [cfgForm, setCfgForm] = useState<Omit<ConfigCliente, "cliente_id">>(
    normalizarConfigCliente(configAtual)
  );
  const cfgDirty =
    cfgForm.exp_usuario !== (configAtual?.exp_usuario ?? "") ||
    cfgForm.exp_senha !== (configAtual?.exp_senha ?? "") ||
    cfgForm.url_abertura_os !== (configAtual?.url_abertura_os ?? "") ||
    cfgForm.url_saldo_horas !== (configAtual?.url_saldo_horas ?? "") ||
    cfgForm.url_tarefas !== (configAtual?.url_tarefas ?? "") ||
    cfgForm.obs !== (configAtual?.obs ?? "");

  const [showSenha, setShowSenha] = useState(false);

  // ── Tab: Automação ──
  const [srConfig, setSrConfig] = useState<StatusReportConfig | null>(null);
  const [srDestinatarios, setSrDestinatarios] = useState<SrDestinatario[]>([]);
  const [modelos, setModelos] = useState<ModeloEmail[]>([]);
  const [srCarregando, setSrCarregando] = useState(false);
  const [srForm, setSrForm] = useState({ ...SR_FORM_VAZIO });
  const [srDestsForm, setSrDestsForm] = useState<string[]>([]);
  const [srEmailInput, setSrEmailInput] = useState("");
  const srOrigRef = useRef({ ...SR_FORM_VAZIO, dests: [] as string[] });

  const srDirty = (() => {
    const orig = srOrigRef.current;
    return (
      srForm.modelo_id !== orig.modelo_id ||
      (srForm.fap ?? "") !== (orig.fap ?? "") ||
      srForm.periodo !== orig.periodo ||
      srForm.dia_envio !== orig.dia_envio ||
      srForm.enviar_sem_os !== orig.enviar_sem_os ||
      srForm.ativo !== orig.ativo ||
      JSON.stringify(srDestsForm.slice().sort()) !== JSON.stringify(orig.dests.slice().sort())
    );
  })();

  // ── Tab: Contrato ──
  const [contratos, setContratos] = useState<ContratoHoras[]>([]);
  const [contratosCarregando, setContratosCarregando] = useState(false);
  const [contratoForm, setContratoForm] = useState({ horas_mensais: "", vigente_de: "", observacao: "" });
  const [contratoSalvando, setContratoSalvando] = useState(false);
  const [contratoExcluindo, setContratoExcluindo] = useState<string | null>(null);

  const anyDirty = idDirty || cfgDirty || srDirty || sustDirty;
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  // Sync quando cliente muda
  useEffect(() => {
    setIdForm({
      nome: cliente.nome,
      cnpj: cliente.cnpj,
      ativo: cliente.ativo,
      sustentacao_desde: cliente.sustentacao_desde ?? "",
      status_sustentacao: cliente.status_sustentacao ?? "ativo",
    });
    setConfirmarExclusao(false);
  }, [cliente.id, cliente.nome, cliente.cnpj, cliente.ativo, cliente.sustentacao_desde, cliente.status_sustentacao]);

  // Sync config quando muda
  useEffect(() => {
    setCfgForm(normalizarConfigCliente(configAtual));
  }, [cliente.id, configAtual]);

  const carregarAutomacao = useCallback(async () => {
    if (isNovo) return;
    setSrCarregando(true);
    const [{ data: cfgData }, { data: modelosData }] = await Promise.all([
      supabase.from("status_report_configs").select("*").eq("cliente_id", cliente.id).limit(1).maybeSingle(),
      supabase.from("modelos_email").select("id, assunto").eq("ativo", true).order("assunto"),
    ]);
    setModelos((modelosData as ModeloEmail[]) ?? []);
    if (cfgData) {
      const cfg = cfgData as StatusReportConfig;
      setSrConfig(cfg);
      const { data: dests } = await supabase
        .from("sr_destinatarios").select("*").eq("config_id", cfg.id).eq("ativo", true);
      const emails = ((dests as SrDestinatario[]) ?? []).map((d) => d.email);
      setSrDestinatarios((dests as SrDestinatario[]) ?? []);
      setSrForm({
        modelo_id: cfg.modelo_id,
        fap: cfg.fap ?? "",
        periodo: cfg.periodo,
        dia_envio: cfg.dia_envio,
        enviar_sem_os: cfg.enviar_sem_os,
        ativo: cfg.ativo,
      });
      setSrDestsForm(emails);
      srOrigRef.current = {
        modelo_id: cfg.modelo_id,
        fap: cfg.fap ?? "",
        periodo: cfg.periodo,
        dia_envio: cfg.dia_envio,
        enviar_sem_os: cfg.enviar_sem_os,
        ativo: cfg.ativo,
        dests: emails,
      };
    } else {
      setSrConfig(null);
      setSrDestinatarios([]);
      setSrForm({ ...SR_FORM_VAZIO });
      setSrDestsForm([]);
      srOrigRef.current = { ...SR_FORM_VAZIO, dests: [] };
    }
    setSrCarregando(false);
  }, [cliente.id, isNovo]);

  useEffect(() => { carregarAutomacao(); }, [carregarAutomacao]);

  const carregarContratos = useCallback(async () => {
    if (isNovo) return;
    setContratosCarregando(true);
    const { data } = await supabase
      .from("contratos_horas")
      .select("*")
      .eq("cliente_id", cliente.id)
      .order("vigente_de", { ascending: false });
    setContratos((data as ContratoHoras[]) ?? []);
    setContratosCarregando(false);
  }, [cliente.id, isNovo]);

  useEffect(() => { carregarContratos(); }, [carregarContratos]);

  async function salvarContrato() {
    const horas = parseFloat(contratoForm.horas_mensais);
    if (!contratoForm.horas_mensais || isNaN(horas) || horas <= 0) {
      toast({ title: "Informe um valor válido de horas", variant: "destructive" });
      return;
    }
    if (!contratoForm.vigente_de) {
      toast({ title: "Informe o mês de vigência", variant: "destructive" });
      return;
    }
    const vigenteDe = `${contratoForm.vigente_de}-01`;
    setContratoSalvando(true);
    const { error } = await supabase.from("contratos_horas").upsert({
      cliente_id: cliente.id,
      horas_mensais: horas,
      vigente_de: vigenteDe,
      observacao: contratoForm.observacao.trim() || null,
    }, { onConflict: "cliente_id,vigente_de" });
    setContratoSalvando(false);
    if (error) {
      toast({ title: "Erro ao salvar contrato", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Contrato salvo!" });
      setContratoForm({ horas_mensais: "", vigente_de: "", observacao: "" });
      carregarContratos();
    }
  }

  async function excluirContrato(id: string) {
    setContratoExcluindo(id);
    const { error } = await supabase.from("contratos_horas").delete().eq("id", id);
    setContratoExcluindo(null);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Período removido" });
      carregarContratos();
    }
  }

  function addSrEmail() {
    const email = srEmailInput.trim().toLowerCase();
    if (!email || !email.includes("@") || srDestsForm.includes(email)) return;
    setSrDestsForm((p) => [...p, email]);
    setSrEmailInput("");
  }

  // ── Salvar tudo ────────────────────────────────────────────────────────────
  async function handleSalvar() {
    if (!idForm.nome.trim()) {
      toast({ title: "Razão social obrigatória", variant: "destructive" });
      return;
    }
    if (idForm.cnpj && !validarCNPJ(idForm.cnpj)) {
      toast({ title: "CNPJ inválido", variant: "destructive" });
      return;
    }
    setSalvando(true);
    try {
      let savedCliente = cliente;

      // 1. Identificação
      if (idDirty || isNovo) {
        const payload = {
          nome: idForm.nome.trim(),
          cnpj: idForm.cnpj,
          ativo: idForm.ativo,
          sustentacao_desde: idForm.sustentacao_desde || null,
          status_sustentacao: idForm.status_sustentacao || "ativo",
        };
        if (isNovo) {
          const { data, error } = await supabase.from("clientes").insert(payload).select().single();
          if (error) throw error;
          savedCliente = data as Cliente;
        } else {
          const { data, error } = await supabase
            .from("clientes")
            .update({ ...payload, atualizado_em: new Date().toISOString() })
            .eq("id", cliente.id)
            .select()
            .single();
          if (error) throw error;
          savedCliente = data as Cliente;
        }
      }

      // 2. Configurações
      if (cfgDirty && !isNovo) {
        const payload: ConfigCliente = {
          cliente_id: savedCliente.id,
          exp_usuario: (cfgForm.exp_usuario ?? "").trim(),
          exp_senha: cfgForm.exp_senha ?? "",
          url_abertura_os: (cfgForm.url_abertura_os ?? "").trim(),
          url_saldo_horas: (cfgForm.url_saldo_horas ?? "").trim(),
          url_tarefas: (cfgForm.url_tarefas ?? "").trim(),
          obs: (cfgForm.obs ?? "").trim(),
        };
        const { error } = await supabase
          .from("configuracoes_clientes")
          .upsert(payload, { onConflict: "cliente_id" });
        if (error) throw error;
      }

      // 3. Automação SR
      if (srDirty && !isNovo) {
        const isSemanal = srForm.periodo === "semanal";
        const minDia = isSemanal ? 0 : 1;
        const maxDia = isSemanal ? 6 : 28;
        if (!Number.isFinite(srForm.dia_envio) || srForm.dia_envio < minDia || srForm.dia_envio > maxDia) {
          throw new Error(isSemanal ? "Dia semanal invÃ¡lido (0â€“6)." : "Dia de envio invÃ¡lido (1â€“28).");
        }

        let configId = srConfig?.id;
        if (srConfig) {
          const { error } = await supabase
            .from("status_report_configs")
            .update({
              modelo_id: srForm.modelo_id,
              fap: srForm.fap || null,
              periodo: srForm.periodo,
              dia_envio: srForm.dia_envio,
              enviar_sem_os: srForm.enviar_sem_os,
              ativo: srForm.ativo,
              atualizado_em: new Date().toISOString(),
            })
            .eq("id", srConfig.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("status_report_configs")
            .insert({
              cliente_id: savedCliente.id,
              modelo_id: srForm.modelo_id,
              fap: srForm.fap || null,
              periodo: srForm.periodo,
              dia_envio: srForm.dia_envio,
              enviar_sem_os: srForm.enviar_sem_os,
              ativo: srForm.ativo,
            })
            .select("id")
            .single();
          if (error) throw error;
          configId = data.id;
        }
        if (configId) {
          await supabase.from("sr_destinatarios").delete().eq("config_id", configId);
          if (srDestsForm.length > 0) {
            const { error } = await supabase.from("sr_destinatarios").insert(
              srDestsForm.map((email) => ({ config_id: configId!, email, ativo: true }))
            );
            if (error) throw error;
          }
        }
        await carregarAutomacao();
        notifySchedulerUpdated();
      }

      toast({ title: "Salvo com sucesso", description: `${savedCliente.nome} atualizado.` });
      onSalvoCliente(savedCliente);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-[var(--shadow-sm)] flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
            <Building2 className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground leading-tight">
              {isNovo ? "Novo Cliente" : idForm.nome || "—"}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {isNovo ? "Preencha os dados abaixo" : (idForm.cnpj || "Sem CNPJ")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Confirmar exclusão inline */}
          <AnimatePresence>
            {confirmarExclusao && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-1.5"
              >
                <span className="text-xs text-destructive font-medium">Confirmar exclusão?</span>
                <button
                  onClick={() => onExcluir(cliente)}
                  className="text-[11px] font-semibold text-destructive hover:underline"
                >
                  Sim
                </button>
                <button
                  onClick={() => setConfirmarExclusao(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Não
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Botão Salvar — aparece só quando dirty */}
          <AnimatePresence>
            {(anyDirty || isNovo) && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
              >
                <Button onClick={handleSalvar} disabled={salvando} size="sm" className="gap-2 h-8 text-xs">
                  {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Salvar
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Sub-abas */}
      <Tabs defaultValue="identificacao" className="w-full flex-1">
        <div className="border-b border-border px-5">
          <TabsList className="h-10 bg-transparent gap-0 p-0 rounded-none">
            {[
              { value: "identificacao", icon: User, label: "Identificação" },
              { value: "configuracoes", icon: Lock, label: "Configurações" },
              ...(isNovo ? [] : [
                { value: "contrato", icon: TrendingUp, label: "Contrato" },
                { value: "automacao", icon: Zap, label: "Automação" },
              ]),
            ].map(({ value, icon: Icon, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[12px] px-4 gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {value === "identificacao" && idDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5" />}
                {value === "configuracoes" && cfgDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5" />}
                {value === "contrato" && sustDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5" />}
                {value === "automacao" && srDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Tab: Identificação */}
        <TabsContent value="identificacao" className="p-5 m-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Nome */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Razão Social <span className="text-destructive normal-case">*</span>
              </Label>
              <Input
                value={idForm.nome}
                onChange={(e) => setIdForm((p) => ({ ...p, nome: e.target.value }))}
                placeholder="Ex: Empresa Exemplo Ltda"
                className="bg-background border-border"
                autoFocus={isNovo}
              />
            </div>

            {/* CNPJ */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">CNPJ</Label>
              <Input
                value={idForm.cnpj}
                onChange={(e) => setIdForm((p) => ({ ...p, cnpj: mascaraCNPJ(e.target.value) }))}
                placeholder="XX.XXX.XXX/XXXX-XX"
                className="bg-background border-border font-mono tracking-wide"
                maxLength={18}
              />
            </div>

            {/* Cadastrado em */}
            {!isNovo && (
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Cadastrado em</Label>
                <div className="flex items-center gap-2 p-2.5 bg-background border border-border rounded-lg">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground">{formatarData(cliente.criado_em)}</span>
                </div>
              </div>
            )}

            {/* Status */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Status</Label>
              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
                <div className="flex items-center gap-2">
                  {idForm.ativo
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    : <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className={`text-sm ${idForm.ativo ? "text-green-700 font-medium" : "text-muted-foreground"}`}>
                    {idForm.ativo ? "Cliente ativo" : "Cliente inativo"}
                  </span>
                </div>
                <Switch
                  checked={idForm.ativo}
                  onCheckedChange={(v) => setIdForm((p) => ({ ...p, ativo: v }))}
                />
              </div>
            </div>

          </div>
        </TabsContent>

        {/* Tab: Configurações */}
        <TabsContent value="configuracoes" className="p-5 m-0 space-y-5">
          {/* Credenciais */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Credenciais de Acesso</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Usuário
                </Label>
                <Input
                  value={cfgForm.exp_usuario}
                  onChange={(e) => setCfgForm((p) => ({ ...p, exp_usuario: e.target.value }))}
                  placeholder="login@empresa.com"
                  className="bg-background border-border text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Senha
                </Label>
                <div className="relative">
                  <Input
                    type={showSenha ? "text" : "password"}
                    value={cfgForm.exp_senha}
                    onChange={(e) => setCfgForm((p) => ({ ...p, exp_senha: e.target.value }))}
                    placeholder="••••••••"
                    className="pr-9 bg-background border-border text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSenha((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSenha ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Links */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Links por Funcionalidade</p>
            </div>
            <div className="space-y-3">
              {LINK_DEFS.map((def) => {
                const Icon = def.icon;
                const val = cfgForm[def.campo as CampoLink] ?? "";
                const preenchido = !!val.trim();
                return (
                  <div
                    key={def.campo}
                    className={`rounded-xl border p-4 transition-colors ${preenchido ? "border-border bg-background" : "border-dashed border-border/60 bg-muted/20"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${def.cor}`}>
                        <Icon className={`h-4 w-4 ${def.corIcon}`} />
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[13px] font-semibold text-foreground leading-tight">{def.titulo}</p>
                            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{def.descricao}</p>
                          </div>
                          {preenchido && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                        </div>
                        <Input
                          value={val}
                          onChange={(e) => setCfgForm((p) => ({ ...p, [def.campo]: e.target.value }))}
                          placeholder="https://..."
                          className="bg-card border-border text-[12px] font-mono h-8"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Observações */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Observações</p>
            </div>
            <textarea
              value={cfgForm.obs}
              onChange={(e) => setCfgForm((p) => ({ ...p, obs: e.target.value }))}
              placeholder="Particularidades deste cliente..."
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
            />
          </div>
        </TabsContent>

        {/* Tab: Contrato */}
        {!isNovo && (
          <TabsContent value="contrato" className="p-5 m-0 space-y-5">
            {contratosCarregando ? (
              <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Carregando...</span>
              </div>
            ) : (
              <>
                {/* Sustentação */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sustentação</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Sustentação desde</Label>
                      <Input
                        type="date"
                        value={idForm.sustentacao_desde}
                        onChange={(e) => setIdForm((p) => ({ ...p, sustentacao_desde: e.target.value }))}
                        className="bg-background border-border text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Status da sustentação</Label>
                      <select
                        value={idForm.status_sustentacao}
                        onChange={(e) => setIdForm((p) => ({ ...p, status_sustentacao: e.target.value }))}
                        className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                      >
                        <option value="ativo">Ativo</option>
                        <option value="inativo">Inativo</option>
                        <option value="suspenso">Suspenso</option>
                      </select>
                      {idForm.sustentacao_desde && idForm.status_sustentacao === "ativo" && (
                        <p className="text-[11px] text-muted-foreground">
                          Ativo desde {formatarData(idForm.sustentacao_desde)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <Separator className="bg-border" />

                {/* Contrato atual */}
                {contratos.length > 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Contrato atual</p>
                        <p className="text-3xl font-bold text-emerald-700 mt-0.5">
                          {contratos[0].horas_mensais}h
                          <span className="text-base font-normal text-emerald-600 ml-1">/ mês</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">Vigente desde</p>
                        <p className="text-sm font-semibold text-foreground mt-0.5">
                          {formatarMesAno(contratos[0].vigente_de)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Registrado em {formatarData(contratos[0].criado_em)}
                        </p>
                      </div>
                    </div>
                    {contratos[0].observacao && (
                      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-emerald-200">
                        {contratos[0].observacao}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
                    <TrendingUp className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhum contrato cadastrado</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">Registre abaixo o valor de horas mensais</p>
                  </div>
                )}

                {/* Formulário novo período */}
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Plus className="h-3 w-3" /> Novo período
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Horas / mês *</Label>
                      <Input
                        type="number"
                        min="1"
                        step="0.5"
                        value={contratoForm.horas_mensais}
                        onChange={(e) => setContratoForm((p) => ({ ...p, horas_mensais: e.target.value }))}
                        placeholder="Ex: 150"
                        className="bg-background border-border text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Vigente a partir de *</Label>
                      <Input
                        type="month"
                        value={contratoForm.vigente_de}
                        onChange={(e) => setContratoForm((p) => ({ ...p, vigente_de: e.target.value }))}
                        className="bg-background border-border text-[13px]"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Observação</Label>
                    <Input
                      value={contratoForm.observacao}
                      onChange={(e) => setContratoForm((p) => ({ ...p, observacao: e.target.value }))}
                      placeholder="Ex: Renovação contratual Q2 2026"
                      className="bg-background border-border text-[13px]"
                    />
                  </div>
                  <Button
                    onClick={salvarContrato}
                    disabled={contratoSalvando}
                    size="sm"
                    className="w-full"
                  >
                    {contratoSalvando ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />}
                    {contratoSalvando ? "Salvando..." : "Salvar contrato"}
                  </Button>
                </div>

                {/* Histórico */}
                {contratos.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Histórico</p>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead className="text-[11px] h-8 py-0">Horas / mês</TableHead>
                            <TableHead className="text-[11px] h-8 py-0">Vigente desde</TableHead>
                            <TableHead className="text-[11px] h-8 py-0">Registrado em</TableHead>
                            <TableHead className="text-[11px] h-8 py-0 w-8" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contratos.map((c, i) => (
                            <TableRow key={c.id} className={i === 0 ? "bg-emerald-50/60" : ""}>
                              <TableCell className="py-2 text-[13px] font-bold text-foreground">
                                {c.horas_mensais}h
                                {i === 0 && (
                                  <span className="ml-2 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">atual</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-[13px] font-mono">{formatarMesAno(c.vigente_de)}</TableCell>
                              <TableCell className="py-2 text-[12px] text-muted-foreground">{formatarData(c.criado_em)}</TableCell>
                              <TableCell className="py-2 text-right">
                                {i === 0 && (
                                  <button
                                    onClick={() => excluirContrato(c.id)}
                                    disabled={contratoExcluindo === c.id}
                                    title="Remover período mais recente"
                                    className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-50"
                                  >
                                    {contratoExcluindo === c.id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Trash2 className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60">
                      Apenas o período mais recente pode ser removido para preservar o histórico.
                    </p>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        )}

        {/* Tab: Automação */}
        {!isNovo && (
          <TabsContent value="automacao" className="p-5 m-0">
            {srCarregando ? (
              <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Carregando...</span>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Header módulo */}
                <div className="flex items-center gap-3 pb-1">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center">
                    <CalendarClock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Status Report</p>
                    <p className="text-[11px] text-muted-foreground">Envio automático de relatório por e-mail</p>
                  </div>
                  <div className="ml-auto">
                    <Badge variant={srConfig?.ativo ? "default" : "secondary"} className="text-[10px]">
                      {srConfig ? (srConfig.ativo ? "Ativo" : "Inativo") : "Não configurado"}
                    </Badge>
                  </div>
                </div>

                <Separator className="bg-border" />

                {/* FAP */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Código FAP</Label>
                    <Input
                      value={srForm.fap ?? ""}
                      onChange={(e) => setSrForm((p) => ({ ...p, fap: e.target.value }))}
                      placeholder="Ex: FAP-001"
                      className="bg-background border-border text-[13px]"
                    />
                  </div>

                  {/* Modelo */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Modelo de E-mail</Label>
                    <Select
                      value={srForm.modelo_id?.toString() ?? "nenhum"}
                      onValueChange={(v) => setSrForm((p) => ({ ...p, modelo_id: v === "nenhum" ? null : Number(v) }))}
                    >
                      <SelectTrigger className="bg-background border-border text-[13px]">
                        <SelectValue placeholder="Selecione um modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">Padrão (sem template)</SelectItem>
                        {modelos.map((m) => (
                          <SelectItem key={m.id} value={m.id.toString()}>{m.assunto}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Período */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Período</Label>
                    <Select
                      value={srForm.periodo}
                      onValueChange={(v) => setSrForm((p) => ({ ...p, periodo: v as typeof p.periodo }))}
                    >
                      <SelectTrigger className="bg-background border-border text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mensal">Mensal</SelectItem>
                        <SelectItem value="quinzenal">Quinzenal</SelectItem>
                        <SelectItem value="semanal">Semanal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Dia envio */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Dia de envio</Label>
                    <Input
                      type="number"
                      min={srForm.periodo === "semanal" ? 0 : 1}
                      max={srForm.periodo === "semanal" ? 6 : 28}
                      value={srForm.dia_envio}
                      onChange={(e) => {
                        const valor = Number(e.target.value);
                        const min = srForm.periodo === "semanal" ? 0 : 1;
                        const max = srForm.periodo === "semanal" ? 6 : 28;
                        setSrForm((p) => ({ ...p, dia_envio: Number.isFinite(valor) ? Math.max(min, Math.min(max, valor)) : min }));
                      }}
                      className="bg-background border-border text-[13px]"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {SR_DIA_ENVIO_HINT[srForm.periodo]}
                    </p>
                  </div>
                </div>

                {/* Switches */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
                    <div>
                      <p className="text-sm font-medium">Enviar sem OS</p>
                      <p className="text-[11px] text-muted-foreground">Envia mesmo quando não há OS no período</p>
                    </div>
                    <Switch
                      checked={srForm.enviar_sem_os}
                      onCheckedChange={(v) => setSrForm((p) => ({ ...p, enviar_sem_os: v }))}
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
                    <div>
                      <p className="text-sm font-medium">Rotina ativa</p>
                      <p className="text-[11px] text-muted-foreground">Ativa ou pausa esta rotina de envio</p>
                    </div>
                    <Switch
                      checked={srForm.ativo}
                      onCheckedChange={(v) => setSrForm((p) => ({ ...p, ativo: v }))}
                    />
                  </div>
                </div>

                {/* Destinatários */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Destinatários
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={srEmailInput}
                      onChange={(e) => setSrEmailInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSrEmail())}
                      placeholder="email@empresa.com — pressione Enter para adicionar"
                      className="bg-background border-border text-[13px]"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addSrEmail} className="shrink-0 px-3">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {srDestsForm.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      <AnimatePresence>
                        {srDestsForm.map((email) => (
                          <motion.div
                            key={email}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-1.5 border border-border/50"
                          >
                            <span className="text-xs font-mono text-foreground">{email}</span>
                            <button
                              type="button"
                              onClick={() => setSrDestsForm((p) => p.filter((e) => e !== email))}
                              className="text-muted-foreground hover:text-destructive transition-colors ml-2"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                  {srDestsForm.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border/60 rounded-lg">
                      Nenhum destinatário adicionado
                    </p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Barra de exclusão */}
      {!isNovo && (
        <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {idForm.ativo ? "Cliente ativo no sistema" : "Cliente inativo"}
          </span>
          <button
            onClick={() => setConfirmarExclusao((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir cliente
          </button>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Clientes() {
  const { toast } = useToast();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");

  const [modo, setModo] = useState<Modo>("lista");
  const [indexSelecionado, setIndexSelecionado] = useState(0);
  const [isNovo, setIsNovo] = useState(false);

  const [configsClientes, setConfigsClientes] = useState<Record<string, ConfigCliente>>({});

  // ── Carregar clientes + configs ──
  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: clientesData, error: erroClientes }, { data: configsData }] = await Promise.all([
      supabase.from("clientes").select("*").order("nome", { ascending: true }),
      supabase.from("configuracoes_clientes").select("*"),
    ]);

    if (erroClientes) {
      toast({ title: "Erro ao carregar clientes", description: erroClientes.message, variant: "destructive" });
    } else {
      setClientes((clientesData as Cliente[]) ?? []);
      if (configsData) {
        const mapa: Record<string, ConfigCliente> = {};
        for (const c of configsData) mapa[c.cliente_id] = c as ConfigCliente;
        setConfigsClientes(mapa);
      }
    }
    setCarregando(false);
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Filtros ──
  const clientesFiltrados = clientes.filter((c) => {
    const termo = busca.toLowerCase();
    const matchBusca = !termo || c.nome.toLowerCase().includes(termo) || c.cnpj.includes(termo);
    const matchStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "ativos" && c.ativo) ||
      (filtroStatus === "inativos" && !c.ativo);
    return matchBusca && matchStatus;
  });

  const clienteAtual = isNovo
    ? ({ id: "__novo__", nome: "", cnpj: "", ativo: true, criado_em: "", atualizado_em: "" } as Cliente)
    : (clientesFiltrados[indexSelecionado] ?? null);

  // ── KPIs ──
  const total = clientes.length;
  const ativos = clientes.filter((c) => c.ativo).length;
  const inativos = total - ativos;

  function novoCliente() {
    setIsNovo(true);
    setModo("formulario");
  }

  function irPara(i: number) {
    setIsNovo(false);
    setIndexSelecionado(Math.max(0, Math.min(clientesFiltrados.length - 1, i)));
    setModo("formulario");
  }

  function onSalvoCliente(c: Cliente) {
    if (isNovo) {
      setIsNovo(false);
      carregar().then(() => {
        // após reload selecionar o novo cliente
        setIndexSelecionado(0);
      });
    } else {
      setClientes((prev) => prev.map((x) => (x.id === c.id ? c : x)));
    }
  }

  async function excluirCliente(c: Cliente) {
    const { error } = await supabase.from("clientes").delete().eq("id", c.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cliente excluído", description: `${c.nome} foi removido.` });
      setModo("lista");
      setIsNovo(false);
      carregar();
    }
  }

  const filtrosBotoes: { key: FiltroStatus; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "ativos", label: "Ativos" },
    { key: "inativos", label: "Inativos" },
  ];

  const idx = isNovo ? -1 : indexSelecionado;
  const navDisabled = isNovo || clientesFiltrados.length === 0;

  return (
    <AppLayout title="Clientes" subtitle="Cadastro e gestão de clientes">
      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Users}     label="Total de Clientes" value={total}    color="bg-primary/10 text-primary"      delay={0} />
        <KpiCard icon={UserCheck} label="Clientes Ativos"   value={ativos}   color="bg-green-500/10 text-green-600" delay={0.05} />
        <KpiCard icon={UserX}     label="Clientes Inativos" value={inativos} color="bg-amber-500/10 text-amber-600" delay={0.1} />
      </div>

      {/* ── Barra estilo Sankhya ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="flex items-center gap-1 bg-card border border-border rounded-xl px-3 py-2.5 shadow-[var(--shadow-sm)]"
      >
        {/* Busca */}
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

        {/* Filtros rápidos */}
        <div className="flex items-center bg-background border border-border rounded-lg p-0.5 gap-0.5 shrink-0">
          {filtrosBotoes.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltroStatus(f.key)}
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

        {/* Novo */}
        <button
          onClick={novoCliente}
          title="Novo cliente"
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Modo formulário toggle */}
        <button
          onClick={() => {
            if (modo === "formulario" && !isNovo) setModo("lista");
            else if (clientesFiltrados.length > 0) { setIsNovo(false); setModo("formulario"); }
          }}
          title={modo === "formulario" ? "Voltar para lista" : "Modo formulário"}
          className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors shrink-0 ${
            modo === "formulario"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <AlignJustify className="h-4 w-4" />
        </button>

        <div className="h-5 w-px bg-border mx-1 shrink-0" />

        {/* Navegação */}
        {[
          { icon: ChevronsLeft,  title: "Primeiro",  action: () => irPara(0),                          disabled: navDisabled || idx <= 0 },
          { icon: ChevronLeft,   title: "Anterior",   action: () => irPara(idx - 1),                   disabled: navDisabled || idx <= 0 },
          { icon: ChevronRight,  title: "Próximo",    action: () => irPara(idx + 1),                   disabled: navDisabled || idx >= clientesFiltrados.length - 1 },
          { icon: ChevronsRight, title: "Último",     action: () => irPara(clientesFiltrados.length - 1), disabled: navDisabled || idx >= clientesFiltrados.length - 1 },
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

        {/* Refresh */}
        <button
          onClick={carregar}
          disabled={carregando}
          title="Atualizar"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
        </button>

        {/* Contador */}
        {!isNovo && modo === "formulario" && clientesFiltrados.length > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono ml-1 shrink-0">
            {idx + 1} / {clientesFiltrados.length}
          </span>
        )}
      </motion.div>

      {/* ── MODO LISTA ── */}
      {modo === "lista" && (
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
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pl-5">Razão Social</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CNPJ</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cadastrado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregando ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-40 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : clientesFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Building2 className="h-8 w-8 opacity-30" />
                        <p className="text-sm font-medium">
                          {busca || filtroStatus !== "todos"
                            ? "Nenhum cliente encontrado para este filtro."
                            : "Nenhum cliente cadastrado ainda."}
                        </p>
                        {!busca && filtroStatus === "todos" && (
                          <Button variant="outline" size="sm" className="mt-1 border-border" onClick={novoCliente}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Cadastrar primeiro cliente
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <AnimatePresence initial={false}>
                    {clientesFiltrados.map((c, i) => (
                      <motion.tr
                        key={c.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 6 }}
                        transition={{ delay: i * 0.02 }}
                        onClick={() => irPara(i)}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <TableCell className="pl-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Building2 className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <span className="font-medium text-[13px] text-foreground">{c.nome}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <span className="font-mono text-[12px] text-muted-foreground tracking-wide">{c.cnpj || "—"}</span>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <Badge
                            variant={c.ativo ? "default" : "outline"}
                            className={`gap-1 text-[11px] ${c.ativo ? "bg-green-500/15 text-green-700 border-green-500/30" : "text-muted-foreground"}`}
                          >
                            {c.ativo ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {c.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <span className="text-[12px] text-muted-foreground font-mono">{formatarData(c.criado_em)}</span>
                        </TableCell>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </TableBody>
            </Table>
          </div>
          {!carregando && clientesFiltrados.length > 0 && (
            <div className="px-5 py-2.5 border-t border-border bg-muted/20">
              <span className="text-[11px] text-muted-foreground">
                {clientesFiltrados.length === clientes.length
                  ? `${total} cliente${total !== 1 ? "s" : ""}`
                  : `${clientesFiltrados.length} de ${total} cliente${total !== 1 ? "s" : ""}`}
                {" · "}clique em uma linha para abrir o formulário
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* ── MODO FORMULÁRIO ── */}
      {modo === "formulario" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          {clienteAtual ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={clienteAtual.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
              >
                <PainelFormulario
                  cliente={clienteAtual}
                  isNovo={isNovo}
                  configAtual={isNovo ? null : (configsClientes[clienteAtual.id] ?? null)}
                  onSalvoCliente={onSalvoCliente}
                  onExcluir={excluirCliente}
                />
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2 bg-card border border-border rounded-xl">
              <Building2 className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum cliente encontrado.</p>
            </div>
          )}
        </motion.div>
      )}
    </AppLayout>
  );
}
