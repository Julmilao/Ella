import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/services/api";
import {
  ClipboardList, Plus, Save, Trash2, Loader2,
  Clock, Calendar, Building2, Tag,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
  Pencil, Terminal, X, Search, AlignJustify, RefreshCw, Filter,
  ClipboardCheck, Play,
  AlertTriangle, Lock, CheckCircle2, Timer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Tipos ─────────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ["Pendente Apontamento", "OS Apontada"] as const;
type StatusOS = typeof STATUS_OPTIONS[number];
const STATUS_ABERTURA_OPTIONS = ["OS Aberta", "OS Não Aberta"] as const;
type StatusAbertura = typeof STATUS_ABERTURA_OPTIONS[number];
type ModoVisualizacao = "formulario" | "grade";
type FiltroStatus = "todos" | "pendentes" | "apontadas";
type TipoAtividade = "os" | "ticket" | "pipefy" | "outro";

const TIPO_ATIVIDADE_OPTIONS: { value: TipoAtividade; label: string; cor: string }[] = [
  { value: "os",     label: "OS",     cor: "bg-blue-100 text-blue-700" },
  { value: "ticket", label: "Ticket", cor: "bg-orange-100 text-orange-700" },
  { value: "pipefy", label: "Pipefy", cor: "bg-violet-100 text-violet-700" },
  { value: "outro",  label: "Outro",  cor: "bg-slate-100 text-slate-600" },
];

interface ClienteItem { id: string; nome: string; }

interface FormState {
  executante: string;
  data_os: string;
  hora_inicio: string;
  hora_fim: string;
  cliente_id: string;
  tipo_atividade: TipoAtividade;
  ticket: string;
  tarefa: string;
  status_os: StatusOS;
  status_abertura: StatusAbertura;
  observacoes: string;
}

interface Apontamento {
  id: string;
  executante: string;
  usuario_id: string | null;
  cliente_id: string;
  cliente_nome: string;
  data_os: string;
  hora_inicio: string;
  hora_fim: string;
  tipo_atividade: TipoAtividade;
  ticket: string | null;
  tarefa: string;
  horas_executadas: number;
  status_os: StatusOS;
  status_abertura: StatusAbertura;
  observacoes: string | null;
  criado_em: string;
  url_tarefas?: string | null;
  exp_usuario?: string | null;
  exp_senha?: string | null;
}

type TipoLog = "sucesso" | "erro" | "aviso" | "info";
interface LogEntry {
  id: number | string;
  tipo: TipoLog;
  mensagem: string;
  hora: string;
}

interface ConflitosHorario {
  id: string;
  cliente_nome: string;
  hora_inicio: string;
  hora_fim: string;
  tarefa: string;
}

// ── Constantes de validação ───────────────────────────────────────────────────
const TAREFA_MIN_CHARS = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcularHoras(inicio: string, fim: string) {
  if (!inicio || !fim) return { decimal: 0, hhmm: "", valido: false };
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  const mins = hf * 60 + mf - (hi * 60 + mi);
  if (mins <= 0 || isNaN(mins)) return { decimal: 0, hhmm: "", valido: false };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return {
    decimal: Math.round((mins / 60) * 100) / 100,
    hhmm: m > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`,
    valido: true,
  };
}

/** Converte horas decimais (ex: 0.83) → "0h 50m" */
function decimalParaHHMM(decimal: number): string {
  if (!decimal || decimal <= 0) return "0h";
  const totalMin = Math.round(decimal * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const fmtHora = (h: string) => (h ? h.slice(0, 5) : "--:--");
const fmtData = (d: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const fmtDataHora = (iso: string) => {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
};

function normalizarTipoLog(tipo: string): TipoLog {
  return tipo === "sucesso" || tipo === "erro" || tipo === "aviso" ? tipo : "info";
}

function isApontamentoPronto(apontamento: Pick<Apontamento, "status_abertura" | "status_os">) {
  return apontamento.status_abertura === "OS Aberta" && apontamento.status_os !== "OS Apontada";
}

const FORM_VAZIO: FormState = {
  executante: "",
  data_os: new Date().toISOString().split("T")[0],
  hora_inicio: "",
  hora_fim: "",
  cliente_id: "",
  tipo_atividade: "os" as TipoAtividade,
  ticket: "",
  tarefa: "",
  status_os: "Pendente Apontamento",
  status_abertura: "OS Não Aberta",
  observacoes: "",
};

// ── Componente principal ──────────────────────────────────────────────────────
export default function LancamentoOS() {
  const { toast } = useToast();
  const { isAdmin, moduleAccess } = useAuth();

  const [modo, setModo] = useState<ModoVisualizacao>("grade");
  const [viewAtual, setViewAtual] = useState<"os" | "logs">("os");
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [indiceAtual, setIndiceAtual] = useState(-1);   // -1 = novo registro
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroAbertura, setFiltroAbertura] = useState<string>("todos");
  const [filtroExecutante, setFiltroExecutante] = useState<string>("todos");
  const [filtroCliente, setFiltroCliente] = useState<string>("todos");

  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [executantes, setExecutantes] = useState<string[]>([]);
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);

  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [executanteLogado, setExecutanteLogado] = useState("");

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [conflitosHorario, setConflitosHorario] = useState<ConflitosHorario[]>([]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selecionadosApontamento, setSelecionadosApontamento] = useState<Set<string>>(new Set());
  const [executandoApontamento, setExecutandoApontamento] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((tipo: TipoLog, mensagem: string) => {
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, { id: Date.now(), tipo, mensagem, hora }]);
  }, []);

  const mergeLogsAutomacao = useCallback((registros: Array<{
    id: string | number;
    tipo: string;
    mensagem: string;
    criado_em: string;
  }>) => {
    if (registros.length === 0) return;
    setLogs((prev) => {
      const idsExistentes = new Set(prev.map((log) => String(log.id)));
      const novos = registros
        .filter((registro) => !idsExistentes.has(`automacao-${registro.id}`))
        .map((registro) => ({
          id: `automacao-${registro.id}`,
          tipo: normalizarTipoLog(registro.tipo),
          mensagem: registro.mensagem,
          hora: new Date(registro.criado_em).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "America/Sao_Paulo",
          }),
        }));

      return novos.length > 0 ? [...prev, ...novos] : prev;
    });
  }, []);

  useEffect(() => {
    if (viewAtual === "logs") logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, viewAtual]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleHoraChange = (field: "hora_inicio" | "hora_fim", val: string) => {
    setForm((p) => ({ ...p, [field]: val }));
  };

  // ── Carregamento ──
  const carregarDados = useCallback(async () => {
    setLoading(true);
    try {
      // Usuário logado
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUsuarioId(user.id);
        const { data: profile } = await supabase
          .from("profiles")
          .select("nome")
          .eq("user_id", user.id)
          .maybeSingle();
        const nome = profile?.nome || user.email || "";
        setExecutanteLogado(nome);
        if (!profile?.nome) {
          addLog("aviso", `Perfil sem nome configurado para o usuário ${user.email} — configure o nome no Painel Admin`);
        }
      }

      // Todos os executantes (profiles com nome)
      const { data: profiles, error: errProfiles } = await supabase
        .from("profiles")
        .select("nome")
        .not("nome", "is", null)
        .order("nome", { ascending: true });
      if (errProfiles) addLog("erro", `Erro ao carregar executantes — ${errProfiles.message}`);
      const nomes = (profiles ?? []).map((p: any) => p.nome as string).filter(Boolean);
      setExecutantes(nomes);

      // Clientes ativos
      const { data: clientesData, error: errClientes } = await supabase
        .from("clientes")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome", { ascending: true });
      if (errClientes) addLog("erro", `Erro ao carregar clientes — ${errClientes.message}`);
      setClientes((clientesData as ClienteItem[]) ?? []);

      // Apontamentos — busca por usuario_id OU executante para garantir visibilidade
      const { data: apts, error: errApts } = await supabase
        .from("solicitacoes_os")
        .select(`
          *,
          clientes(nome, configuracoes_clientes(url_tarefas, exp_usuario, exp_senha))
        `)
        .order("data_os", { ascending: false })
        .order("hora_inicio", { ascending: false })
        .limit(500);
      if (errApts) addLog("erro", `Erro ao carregar apontamentos — ${errApts.message}`);

      const lista = (apts ?? []).map((a: any) => {
        const cfg = Array.isArray(a.clientes?.configuracoes_clientes)
          ? a.clientes.configuracoes_clientes[0] ?? {}
          : a.clientes?.configuracoes_clientes ?? {};

        return {
        ...a,
        cliente_nome: a.clientes?.nome ?? "–",
        hora_inicio: a.hora_inicio?.slice(0, 5) ?? "",
        hora_fim: a.hora_fim?.slice(0, 5) ?? "",
        url_tarefas: cfg.url_tarefas ?? null,
        exp_usuario: cfg.exp_usuario ?? null,
        exp_senha: cfg.exp_senha ?? null,
      };
      });
      setApontamentos(lista);

      if (lista.length === 0) {
        addLog("aviso", "Nenhum apontamento retornado — se você tem registros, pode haver uma política RLS bloqueando o acesso. Verifique no Supabase SQL Editor: SELECT id, usuario_id, executante FROM solicitacoes_os LIMIT 5;");
      } else {
        addLog("info", `Dados carregados — ${nomes.length} executante(s), ${(clientesData ?? []).length} cliente(s), ${lista.length} apontamento(s)`);
      }
    } catch (err: any) {
      addLog("erro", `Falha inesperada ao carregar dados — ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  useEffect(() => { carregarDados(); }, [carregarDados]);

  useEffect(() => {
    setConflitosHorario([]);
  }, [form.executante, form.data_os, form.hora_inicio, form.hora_fim]);

  const apontamentosFiltrados = useMemo(() => apontamentos.filter((apontamento) => {
    const termo = busca.trim().toLowerCase();
    const matchBusca =
      !termo ||
      apontamento.executante.toLowerCase().includes(termo) ||
      apontamento.cliente_nome.toLowerCase().includes(termo) ||
      (apontamento.ticket ?? "").toLowerCase().includes(termo) ||
      apontamento.tarefa.toLowerCase().includes(termo) ||
      fmtData(apontamento.data_os).includes(termo);

    const matchStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "pendentes" && apontamento.status_os === "Pendente Apontamento") ||
      (filtroStatus === "apontadas" && apontamento.status_os === "OS Apontada");

    const matchAbertura =
      filtroAbertura === "todos" || apontamento.status_abertura === filtroAbertura;

    const matchExecutante =
      filtroExecutante === "todos" || apontamento.executante === filtroExecutante;

    const matchCliente =
      filtroCliente === "todos" || apontamento.cliente_nome === filtroCliente;

    return matchBusca && matchStatus && matchAbertura && matchExecutante && matchCliente;
  }), [apontamentos, busca, filtroStatus, filtroAbertura, filtroExecutante, filtroCliente]);

  const podeApontarAutomatico = isAdmin || moduleAccess.has("automacao_os");
  const apontamentosProntos = useMemo(
    () => apontamentosFiltrados.filter((apontamento) => isApontamentoPronto(apontamento)),
    [apontamentosFiltrados],
  );
  const apontamentosSelecionadosParaApontamento = useMemo(
    () => apontamentosProntos.filter((apontamento) => selecionadosApontamento.has(apontamento.id)),
    [apontamentosProntos, selecionadosApontamento],
  );
  const prontasSemUrl = useMemo(
    () => apontamentosProntos.filter((apontamento) => !apontamento.url_tarefas).length,
    [apontamentosProntos],
  );
  const todasProntasSelecionadas =
    apontamentosProntos.length > 0 &&
    apontamentosSelecionadosParaApontamento.length === apontamentosProntos.length;

  useEffect(() => {
    setSelecionadosApontamento((prev) => {
      if (prev.size === 0) return prev;
      const idsValidos = new Set(apontamentosProntos.map((apontamento) => apontamento.id));
      const next = new Set([...prev].filter((id) => idsValidos.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [apontamentosProntos]);

  // ── Sincroniza form com registro atual (modo formulário) ──
  useEffect(() => {
    if (modo !== "formulario") return;
    if (indiceAtual === -1) {
      setForm((p) => ({ ...FORM_VAZIO, executante: p.executante || executanteLogado }));
      return;
    }
    const a = apontamentosFiltrados[indiceAtual];
    if (!a) return;
    setForm({
      executante: a.executante,
      data_os: a.data_os,
      hora_inicio: a.hora_inicio,
      hora_fim: a.hora_fim,
  
      cliente_id: a.cliente_id,
      tipo_atividade: (a.tipo_atividade ?? "os") as TipoAtividade,
      ticket: a.ticket ?? "",
      tarefa: a.tarefa,
      status_os: a.status_os,
      status_abertura: (a.status_abertura as StatusAbertura) ?? "OS Não Aberta",
      observacoes: a.observacoes ?? "",
    });
  }, [apontamentosFiltrados, executanteLogado, indiceAtual, modo]);

  // ── Navegação ──
  const total = apontamentosFiltrados.length;
  const totalGeral = apontamentos.length;
  const isNovo = indiceAtual === -1;
  const registroAtual = isNovo ? null : (apontamentosFiltrados[indiceAtual] ?? null);
  const registroAtualProntoParaApontar = registroAtual ? isApontamentoPronto(registroAtual) : false;

  const navPrimeiro  = () => setIndiceAtual(0);
  const navAnterior  = () => setIndiceAtual((i) => Math.max(0, i - 1));
  const navProximo   = () => setIndiceAtual((i) => Math.min(total - 1, i + 1));
  const navUltimo    = () => setIndiceAtual(total - 1);

  const novoRegistro = () => {
    setIndiceAtual(-1);
    setForm((p) => ({ ...FORM_VAZIO, executante: p.executante || executanteLogado }));
    setModo("formulario");
  };

  const abrirFormulario = (index: number) => {
    setIndiceAtual(index);
    setModo("formulario");
  };

  useEffect(() => {
    if (isNovo || total === 0 || indiceAtual < total) return;
    setIndiceAtual(Math.max(0, total - 1));
  }, [indiceAtual, isNovo, total]);

  // ── Auto-set executante para não-admin em novo registro ──
  useEffect(() => {
    if (!isAdmin && isNovo && executanteLogado) {
      setForm((p) => ({ ...p, executante: executanteLogado }));
    }
  }, [isAdmin, isNovo, executanteLogado]);

  // ── Salvar (insert ou update) ──
  const toggleSelecionadoApontamento = (id: string) => {
    setSelecionadosApontamento((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTodosApontamentosProntos = () => {
    if (todasProntasSelecionadas) {
      setSelecionadosApontamento(new Set());
      return;
    }

    setSelecionadosApontamento(new Set(apontamentosProntos.map((apontamento) => apontamento.id)));
  };

  const iniciarPollingLogsApontamento = useCallback((execucaoId: string) => {
    let tentativas = 0;
    const maxTentativas = 120;
    const interval = window.setInterval(async () => {
      tentativas += 1;
      try {
        const { data } = await supabase
          .from("logs")
          .select("id, tipo, mensagem, criado_em")
          .eq("execucao_id", execucaoId)
          .eq("modulo", "automacao_os")
          .order("criado_em", { ascending: true });

        const registros = (data ?? []) as Array<{
          id: string | number;
          tipo: string;
          mensagem: string;
          criado_em: string;
        }>;

        if (registros.length > 0) {
          mergeLogsAutomacao(registros);
          const ultimo = registros[registros.length - 1];
          const mensagemFinal = ultimo.mensagem.toLowerCase();
          const finalizou =
            ["sucesso", "aviso"].includes(ultimo.tipo) &&
            (mensagemFinal.includes("finalizado") || mensagemFinal.includes("apontamento finalizado"));

          if (finalizou) {
            clearInterval(interval);
            setExecutandoApontamento(false);
            setSelecionadosApontamento(new Set());
            void carregarDados();
            return;
          }
        }

        if (tentativas >= maxTentativas) {
          clearInterval(interval);
          setExecutandoApontamento(false);
          addLog("aviso", "Monitoramento do apontamento encerrado por tempo limite. Atualize a tela para conferir o resultado final.");
          void carregarDados();
        }
      } catch {
        if (tentativas >= maxTentativas) {
          clearInterval(interval);
          setExecutandoApontamento(false);
        }
      }
    }, 2000);
  }, [addLog, carregarDados, mergeLogsAutomacao]);

  const executarApontamentoAutomatico = useCallback(async (alvo: Apontamento[]) => {
    if (!podeApontarAutomatico) {
      toast({
        title: "Sem acesso ao apontamento automático",
        description: "Seu perfil não possui acesso ao módulo de automação.",
        variant: "destructive",
      });
      return;
    }

    if (alvo.length === 0) {
      toast({
        title: "Nenhuma OS selecionada",
        description: "Selecione ao menos uma OS pronta para apontar.",
        variant: "destructive",
      });
      return;
    }

    const semUrl = alvo.filter((apontamento) => !apontamento.url_tarefas);
    if (semUrl.length > 0) {
      addLog(
        "aviso",
        `${semUrl.length} OS sem URL de Tarefas configurada: ${semUrl.map((apontamento) => apontamento.cliente_nome).join(", ")}. Configure em Cadastros > Clientes > Configuracoes.`,
      );
    }

    const itens = alvo
      .filter((apontamento) => apontamento.url_tarefas)
      .map((apontamento) => ({
        apontamento_id: apontamento.id,
        executante: apontamento.executante,
        cliente_id: apontamento.cliente_id,
        cliente_nome: apontamento.cliente_nome,
        data_os: apontamento.data_os,
        hora_inicio: apontamento.hora_inicio,
        hora_fim: apontamento.hora_fim,
        ticket: apontamento.ticket,
        tarefa: apontamento.tarefa,
        observacoes: apontamento.observacoes,
        url_tarefas: apontamento.url_tarefas,
        exp_usuario: apontamento.exp_usuario,
        exp_senha: apontamento.exp_senha,
      }));

    if (itens.length === 0) {
      toast({
        title: "Nenhuma OS com URL de Tarefas configurada",
        description: "Configure a URL de Tarefas em Cadastros > Clientes > Configuracoes.",
        variant: "destructive",
      });
      return;
    }

    setExecutandoApontamento(true);
    setViewAtual("logs");
    addLog("info", `Disparando apontamento automatico para ${itens.length} OS...`);

    try {
      const resp = await apiFetch("/executar-apontamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itens),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? "Erro desconhecido no servidor.");
      }

      const resultado = await resp.json();
      addLog("sucesso", `Apontamento iniciado em background. ID de execucao: ${resultado.execucao_id}`);
      toast({
        title: "Apontamento iniciado",
        description: "O RPA esta processando as OS em background.",
      });
      iniciarPollingLogsApontamento(resultado.execucao_id);
    } catch (err: any) {
      addLog("erro", `Falha ao iniciar apontamento automatico: ${err.message}`);
      toast({ title: "Erro ao iniciar", description: err.message, variant: "destructive" });
      setExecutandoApontamento(false);
    }
  }, [addLog, iniciarPollingLogsApontamento, podeApontarAutomatico, toast]);

  const handleSalvar = async () => {
    const clienteNome = clientes.find((c) => c.id === form.cliente_id)?.nome ?? form.cliente_id;

    const faltando = [
      !form.executante && "executante",
      !form.data_os && "data",
      !form.hora_inicio && "hora início",
      !form.hora_fim && "hora fim",
      !form.cliente_id && "cliente",
      !form.tarefa.trim() && "tarefa",
      (form.tipo_atividade !== "outro" && !form.ticket.trim()) && "número de referência",
    ].filter(Boolean);

    if (faltando.length > 0) {
      addLog("aviso", `Salvamento bloqueado — campos obrigatórios não preenchidos: ${faltando.join(", ")}`);
      toast({ title: "Campos obrigatórios", description: "Preencha executante, data, horários, cliente e tarefa.", variant: "destructive" });
      return;
    }

    // Mínimo de caracteres na tarefa
    if (form.tarefa.trim().length < TAREFA_MIN_CHARS) {
      const faltam = TAREFA_MIN_CHARS - form.tarefa.trim().length;
      addLog("aviso", `Tarefa muito curta — mínimo de ${TAREFA_MIN_CHARS} caracteres exigido (faltam ${faltam})`);
      toast({
        title: "Descrição insuficiente",
        description: `A tarefa deve ter no mínimo ${TAREFA_MIN_CHARS} caracteres. Faltam ${faltam}.`,
        variant: "destructive",
      });
      return;
    }

    // Bloqueia "OS Apontada" se a OS ainda não foi aberta pelo RPA
    if (form.status_os === "OS Apontada" && form.status_abertura !== "OS Aberta") {
      addLog("aviso", `Status bloqueado — tentativa de marcar "OS Apontada" sem que a abertura esteja como "OS Aberta" (status atual: ${form.status_abertura})`);
      toast({
        title: "Ação bloqueada",
        description: 'Só é possível marcar "OS Apontada" quando o Status Abertura for "OS Aberta".',
        variant: "destructive",
      });
      return;
    }

    const horas = calcularHoras(form.hora_inicio, form.hora_fim);
    if (!horas.valido) {
      addLog("aviso", `Horário inválido — executante: ${form.executante}, início: ${form.hora_inicio}, fim: ${form.hora_fim} (fim deve ser maior que início)`);
      toast({ title: "Horário inválido", description: "Hora fim deve ser maior que hora início.", variant: "destructive" });
      return;
    }

    // Verificar conflito de horários (strict overlap: endpoints iguais não conflitam)
    const { data: conflitosRaw } = await supabase
      .from("solicitacoes_os")
      .select("id, hora_inicio, hora_fim, tarefa, clientes(nome)")
      .eq("executante", form.executante)
      .eq("data_os", form.data_os)
      .lt("hora_inicio", form.hora_fim)
      .gt("hora_fim", form.hora_inicio);

    const conflitosReais: ConflitosHorario[] = (conflitosRaw ?? [])
      .filter((c: any) => c.id !== (registroAtual?.id ?? ""))
      .map((c: any) => ({
        id: c.id,
        cliente_nome: (c.clientes as any)?.nome ?? "–",
        hora_inicio: (c.hora_inicio as string)?.slice(0, 5) ?? "",
        hora_fim: (c.hora_fim as string)?.slice(0, 5) ?? "",
        tarefa: c.tarefa as string,
      }));

    if (conflitosReais.length > 0) {
      setConflitosHorario(conflitosReais);
      addLog("aviso", `Conflito de horário — ${form.executante} já tem ${conflitosReais.length} OS em ${fmtData(form.data_os)} no intervalo ${form.hora_inicio}–${form.hora_fim}`);
      toast({
        title: "Conflito de horário",
        description: `${form.executante} já tem ${conflitosReais.length > 1 ? `${conflitosReais.length} atividades` : "uma atividade"} neste horário. Ajuste os horários e tente novamente.`,
        variant: "destructive",
      });
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        executante: form.executante,
        usuario_id: usuarioId,
        cliente_id: form.cliente_id,
        data_os: form.data_os,
        hora_inicio: form.hora_inicio,
        hora_fim: form.hora_fim,
        tipo_atividade: form.tipo_atividade,
        ticket: form.ticket.trim() || null,
        tarefa: form.tarefa.trim(),
        horas_executadas: horas.decimal,
        status_os: form.status_os,
        status_abertura: form.status_abertura,
        observacoes: form.observacoes.trim() || null,
      };

      if (isNovo) {
        const { error } = await supabase.from("solicitacoes_os").insert(payload);
        if (error) throw error;
        addLog("sucesso", `Apontamento criado — executante: ${form.executante}, cliente: ${clienteNome}, data: ${fmtData(form.data_os)}, horas: ${horas.hhmm} (${horas.decimal}h), status: ${form.status_os}${form.ticket ? `, ticket: ${form.ticket}` : ""}`);
        toast({ title: "OS SOLICITADA!" });
        await carregarDados();
        setIndiceAtual(0);

        
      } else {
        const id = registroAtual?.id;
        if (!id) throw new Error("Registro atual não encontrado.");
        const { error } = await supabase
          .from("solicitacoes_os")
          .update({ ...payload, atualizado_em: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
        addLog("sucesso", `Apontamento atualizado — executante: ${form.executante}, cliente: ${clienteNome}, data: ${fmtData(form.data_os)}, horas: ${horas.hhmm} (${horas.decimal}h), status: ${form.status_os}`);
        toast({ title: "Apontamento atualizado!" });
        await carregarDados();
      }
    } catch (err: any) {
      addLog("erro", `Erro ao salvar apontamento — executante: ${form.executante}, cliente: ${clienteNome} — motivo: ${err.message}`);
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  // ── Excluir ──
  const handleExcluir = useCallback(async (id?: string) => {
    const alvoId = id ?? (isNovo ? null : registroAtual?.id);
    if (!alvoId) return;
    const alvo = apontamentos.find((a) => a.id === alvoId);
    const contexto = alvo
      ? `executante: ${alvo.executante}, cliente: ${alvo.cliente_nome}, data: ${fmtData(alvo.data_os)}`
      : `id: ${alvoId}`;
    setExcluindoId(alvoId);
    try {
      const { error } = await supabase.from("solicitacoes_os").delete().eq("id", alvoId);
      if (error) throw error;
      addLog("sucesso", `Apontamento excluído — ${contexto}`);
      toast({ title: "Apontamento excluído" });
      await carregarDados();
      if (!id) {
        const novo = Math.min(indiceAtual, total - 2);
        setIndiceAtual(novo < 0 ? -1 : novo);
      }
    } catch (err: any) {
      addLog("erro", `Erro ao excluir apontamento — ${contexto} — motivo: ${err.message}`);
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    } finally {
      setExcluindoId(null);
    }
  }, [addLog, apontamentos, carregarDados, indiceAtual, isNovo, registroAtual?.id, toast, total]);

  const totalHoras = apontamentosFiltrados.reduce((acc, a) => acc + Number(a.horas_executadas || 0), 0);
  const filtrosBotoes: { key: FiltroStatus; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "pendentes", label: "Pendentes" },
    { key: "apontadas", label: "Apontadas" },
  ];

  const executantesUnicos = useMemo(() =>
    [...new Set(apontamentos.map((a) => a.executante).filter(Boolean))].sort(),
  [apontamentos]);

  const clientesUnicos = useMemo(() =>
    [...new Set(apontamentos.map((a) => a.cliente_nome).filter((n) => n && n !== "–"))].sort(),
  [apontamentos]);
  const idx = isNovo ? -1 : indiceAtual;
  const navDisabled = isNovo || total === 0;


  // ── Header extra (toggle de modo) ────────────────────────────────────────────
  /*
    <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-background">
      <button
        onClick={() => setModo("grade")}
        title="Modo Grade"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
          modo === "grade"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Grade
      </button>
      <button
        onClick={() => { setIndiceAtual(-1); setModo("formulario"); }}
        title="Modo Formulário"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
          modo === "formulario"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <FileText className="h-3.5 w-3.5" />
        Formulário
      </button>
    </div>
  */

  // ── Campos do formulário ──────────────────────────────────────────────────
  const inputCls = "w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors";
  const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide";

  const horasCalc = calcularHoras(form.hora_inicio, form.hora_fim);

  const FormFields = (
    <div className="p-6 grid grid-cols-2 gap-x-6 gap-y-4">

      {/* Executante */}
      <div className="space-y-1.5">
        <label className={labelCls}>Executante *</label>
        {isAdmin ? (
          <select value={form.executante} onChange={(e) => set("executante", e.target.value)} className={inputCls}>
            <option value="">Selecionar executante...</option>
            {executantes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <div className={`${inputCls} text-muted-foreground bg-muted/30 cursor-default`}>
            {executanteLogado || "–"}
          </div>
        )}
      </div>

      {/* Cliente */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}><Building2 className="h-3 w-3" /> Cliente *</label>
        <select value={form.cliente_id} onChange={(e) => set("cliente_id", e.target.value)} className={inputCls}>
          <option value="">Selecionar cliente...</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {/* Data */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}><Calendar className="h-3 w-3" /> Data *</label>
        <input type="date" value={form.data_os} onChange={(e) => set("data_os", e.target.value)} className={inputCls} />
      </div>

      {/* Tipo de atividade */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}>
          <Tag className="h-3 w-3" /> Tipo de atividade *
        </label>
        <select
          value={form.tipo_atividade}
          onChange={(e) => set("tipo_atividade", e.target.value as TipoAtividade)}
          className={inputCls}
        >
          {TIPO_ATIVIDADE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Referência / Número (col-span-2, required quando não é OS) */}
      <div className="col-span-2 space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}>
          <Tag className="h-3 w-3" />
          {form.tipo_atividade === "os" ? "Número da OS" : `Número do ${TIPO_ATIVIDADE_OPTIONS.find(o => o.value === form.tipo_atividade)?.label}`}
          {form.tipo_atividade !== "outro"
            ? <span className="text-destructive ml-0.5">*</span>
            : <span className="text-[10px] normal-case font-normal opacity-60 ml-1">(opcional)</span>
          }
        </label>
        <input
          type="text"
          value={form.ticket}
          onChange={(e) => set("ticket", e.target.value)}
          placeholder={
            form.tipo_atividade === "os"     ? "OS-12345 ou referência..." :
            form.tipo_atividade === "ticket" ? "Número do ticket obrigatório..." :
            form.tipo_atividade === "pipefy" ? "ID do card no Pipefy..." :
                                              "Descrição ou referência..."
          }
          className={`${inputCls} ${form.tipo_atividade !== "outro" && !form.ticket.trim() ? "border-destructive/60 focus:border-destructive" : ""}`}
        />
      </div>

      {/* Hora início */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}><Clock className="h-3 w-3" /> Hora início *</label>
        <input type="time" value={form.hora_inicio} onChange={(e) => handleHoraChange("hora_inicio", e.target.value)} className={inputCls} />
      </div>

      {/* Hora fim */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}><Clock className="h-3 w-3" /> Hora fim *</label>
        <input type="time" value={form.hora_fim} onChange={(e) => handleHoraChange("hora_fim", e.target.value)} className={inputCls} />
      </div>

      {/* Horas executadas (read-only) — col-span-2 centralizado */}
      <div className="col-span-2 space-y-1.5">
        <label className={labelCls}>Horas executadas</label>
        <div className={`w-full text-sm border rounded-lg px-3 py-2.5 font-mono font-bold transition-colors ${
          horasCalc.valido
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-border bg-muted/30 text-muted-foreground"
        }`}>
          {horasCalc.valido ? horasCalc.hhmm : "–"}
        </div>
      </div>

      {/* Status OS */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1.5`}>
          Status da OS
          {form.status_abertura !== "OS Aberta" && (
            <span className="flex items-center gap-1 normal-case font-normal text-[10px] text-muted-foreground/70">
              <Lock className="h-2.5 w-2.5" /> aguardando abertura
            </span>
          )}
        </label>
        <select
          value={form.status_os}
          disabled={form.status_abertura !== "OS Aberta"}
          onChange={(e) => set("status_os", e.target.value as StatusOS)}
          className={`${inputCls} ${form.status_abertura !== "OS Aberta" ? "cursor-not-allowed opacity-50 bg-muted/30" : ""}`}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Status Abertura (RPA) */}
      <div className="space-y-1.5">
        <label className={`${labelCls} flex items-center gap-1`}>
          Status Abertura
          <span className="text-[10px] normal-case font-normal opacity-60 ml-1">(RPA)</span>
        </label>
        {isAdmin ? (
          <select
            value={form.status_abertura}
            onChange={(e) => set("status_abertura", e.target.value as StatusAbertura)}
            className={inputCls}
          >
            {STATUS_ABERTURA_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <div className={`w-full text-sm border rounded-lg px-3 py-2.5 font-medium cursor-default transition-colors ${
            form.status_abertura === "OS Aberta"
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}>
            {form.status_abertura}
          </div>
        )}
      </div>

      {/* Tarefa — col-span-2 */}
      <div className="col-span-2 space-y-1.5">
        <label className={labelCls}>Tarefa / Descrição *</label>
        <textarea
          value={form.tarefa}
          onChange={(e) => set("tarefa", e.target.value)}
          placeholder="Descreva a atividade executada com detalhes..."
          rows={4}
          className={`${inputCls} resize-none ${
            form.tarefa.trim().length > 0 && form.tarefa.trim().length < TAREFA_MIN_CHARS
              ? "border-amber-400 focus:border-amber-500"
              : ""
          }`}
        />
        <div className="flex items-center justify-between">
          <span className={`text-xs ${
            form.tarefa.trim().length === 0
              ? "text-muted-foreground"
              : form.tarefa.trim().length < TAREFA_MIN_CHARS
              ? "text-amber-600"
              : "text-green-600"
          }`}>
            {form.tarefa.trim().length < TAREFA_MIN_CHARS
              ? `Mínimo ${TAREFA_MIN_CHARS} caracteres — faltam ${TAREFA_MIN_CHARS - form.tarefa.trim().length}`
              : "Descrição suficiente"}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {form.tarefa.trim().length}/{TAREFA_MIN_CHARS}
          </span>
        </div>
      </div>

      {/* Observações — col-span-2 */}
      <div className="col-span-2 space-y-1.5">
        <label className={labelCls}>
          Observações
          <span className="text-[10px] normal-case font-normal opacity-60 ml-1">(opcional)</span>
        </label>
        <textarea
          value={form.observacoes}
          onChange={(e) => set("observacoes", e.target.value)}
          placeholder="Anotações adicionais..."
          rows={2}
          className={`${inputCls} resize-none`}
        />
      </div>
    </div>
  );

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <AppLayout
      title="Controle de OS"
      subtitle={
        modo === "formulario"
          ? isNovo
            ? "Modo Formulário · Novo registro"
            : `Modo Formulário · Registro ${indiceAtual + 1} de ${total}`
          : `Modo Grade · ${total} registro${total !== 1 ? "s" : ""}`
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="flex items-center gap-1 bg-card border border-border rounded-xl px-3 py-2.5 shadow-[var(--shadow-sm)]"
      >
        <div className="relative flex-1 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              if (!isNovo) setIndiceAtual(0);
            }}
            placeholder="Pesquisar..."
            className="pl-8 pr-8 h-8 bg-background border-border text-xs"
          />
          {busca && (
            <button
              onClick={() => {
                setBusca("");
                if (!isNovo) setIndiceAtual(0);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center bg-background border border-border rounded-lg p-0.5 gap-0.5 shrink-0">
          {filtrosBotoes.map((filtro) => (
            <button
              key={filtro.key}
              onClick={() => {
                setFiltroStatus(filtro.key);
                if (!isNovo) setIndiceAtual(0);
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                filtroStatus === filtro.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {filtro.label}
            </button>
          ))}
        </div>

        {/* Filtro por status abertura */}
        <Select value={filtroAbertura} onValueChange={(v) => { setFiltroAbertura(v); if (!isNovo) setIndiceAtual(0); }}>
          <SelectTrigger className="h-8 text-xs w-36 bg-background border-border shrink-0">
            <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
            <SelectValue placeholder="Abertura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Toda abertura</SelectItem>
            <SelectItem value="OS Aberta">OS Aberta</SelectItem>
            <SelectItem value="OS Não Aberta">OS Não Aberta</SelectItem>
          </SelectContent>
        </Select>

        {/* Filtro por executante */}
        <Select value={filtroExecutante} onValueChange={(v) => { setFiltroExecutante(v); if (!isNovo) setIndiceAtual(0); }}>
          <SelectTrigger className="h-8 text-xs w-36 bg-background border-border shrink-0">
            <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
            <SelectValue placeholder="Executante" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos executantes</SelectItem>
            {executantesUnicos.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Filtro por cliente */}
        <Select value={filtroCliente} onValueChange={(v) => { setFiltroCliente(v); if (!isNovo) setIndiceAtual(0); }}>
          <SelectTrigger className="h-8 text-xs w-40 bg-background border-border shrink-0">
            <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos clientes</SelectItem>
            {clientesUnicos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="h-5 w-px bg-border mx-1 shrink-0" />

        <button
          onClick={novoRegistro}
          title="Nova solicitação de OS"
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
        </button>

        <button
          onClick={() => {
            if (modo === "formulario" && !isNovo) {
              setModo("grade");
            } else if (total > 0) {
              setIndiceAtual((atual) => (atual >= 0 && atual < total ? atual : 0));
              setModo("formulario");
            }
          }}
          title={modo === "formulario" ? "Voltar para grade" : "Modo formulario"}
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
          { icon: ChevronsLeft, title: "Primeiro", action: navPrimeiro, disabled: navDisabled || idx <= 0 },
          { icon: ChevronLeft, title: "Anterior", action: navAnterior, disabled: navDisabled || idx <= 0 },
          { icon: ChevronRight, title: "Proximo", action: navProximo, disabled: navDisabled || idx >= total - 1 },
          { icon: ChevronsRight, title: "Ultimo", action: navUltimo, disabled: navDisabled || idx >= total - 1 },
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
          onClick={carregarDados}
          disabled={loading}
          title="Atualizar"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        {!isNovo && modo === "formulario" && total > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono ml-1 shrink-0">
            {indiceAtual + 1} / {total}
          </span>
        )}

        {!isNovo && modo === "formulario" && registroAtual && (
          <>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
              registroAtual.status_os === "OS Apontada"
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}>
              {registroAtual.status_os}
            </span>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
              (registroAtual.status_abertura ?? "OS Não Aberta") === "OS Aberta"
                ? "bg-blue-100 text-blue-700"
                : "bg-slate-100 text-slate-500"
            }`}>
              {registroAtual.status_abertura ?? "OS Não Aberta"}
            </span>
            <button
              onClick={() => handleExcluir()}
              disabled={!!excluindoId}
              className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 transition-all disabled:opacity-50 shrink-0"
            >
              {excluindoId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Excluir
            </button>
          </>
        )}
      </motion.div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            icon: ClipboardList,
            label: "Registros",
            value: total !== totalGeral ? `${total} / ${totalGeral}` : `${total}`,
            sub: total !== totalGeral ? "com filtros ativos" : "total no período",
            color: "bg-primary/10 text-primary",
            delay: 0,
          },
          {
            icon: Timer,
            label: "Horas executadas",
            value: decimalParaHHMM(totalHoras),
            sub: `${total} apontamento${total !== 1 ? "s" : ""}`,
            color: "bg-blue-500/10 text-blue-600",
            delay: 0.05,
          },
          {
            icon: AlertTriangle,
            label: "Pendentes",
            value: apontamentosFiltrados.filter((a) => a.status_os === "Pendente Apontamento").length,
            sub: "aguardando apontamento",
            color: "bg-amber-500/10 text-amber-600",
            delay: 0.1,
          },
          {
            icon: CheckCircle2,
            label: "OS Abertas",
            value: apontamentosFiltrados.filter((a) => a.status_abertura === "OS Aberta").length,
            sub: "abertas pelo RPA",
            color: "bg-green-500/10 text-green-600",
            delay: 0.15,
          },
        ].map(({ icon: Icon, label, value, sub, color, delay }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.3 }}
          >
            <Card className="border-border bg-card">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
                  <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ── Barra OS / Log ── */}
      {viewAtual === "os" && modo === "grade" && podeApontarAutomatico && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-sm)] lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <ClipboardCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Gatilho de apontamento automático</p>
              <p className="text-[11px] text-muted-foreground">
                Use os filtros da grade, marque as OS prontas e dispare o apontamento sem sair de Controle de OS.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
              {apontamentosProntos.length} pronta{apontamentosProntos.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              {apontamentosSelecionadosParaApontamento.length} selecionada{apontamentosSelecionadosParaApontamento.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              {prontasSemUrl} sem URL
            </span>
            <button
              onClick={toggleTodosApontamentosProntos}
              disabled={executandoApontamento || apontamentosProntos.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {todasProntasSelecionadas ? "Desmarcar prontas" : "Selecionar prontas"}
            </button>
            <button
              onClick={() => void executarApontamentoAutomatico(apontamentosSelecionadosParaApontamento)}
              disabled={executandoApontamento || apontamentosSelecionadosParaApontamento.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executandoApontamento
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Apontando...</>
                : <><Play className="h-3.5 w-3.5" /> Iniciar apontamento</>}
            </button>
          </div>
        </motion.div>
      )}

      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2 shadow-[var(--shadow-sm)]">
        <span className="text-[11px] text-muted-foreground font-mono">
          {viewAtual === "os"
            ? `Modo ${modo === "grade" ? "Grade" : "Formulário"} · ${total} registro${total !== 1 ? "s" : ""}${total !== totalGeral ? ` de ${totalGeral}` : ""}`
            : `${logs.length} evento${logs.length !== 1 ? "s" : ""} no histórico`}
        </span>
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-background">
          <button
            onClick={() => setViewAtual("os")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              viewAtual === "os"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            OS
          </button>
          <button
            onClick={() => setViewAtual("logs")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              viewAtual === "logs"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            Log de Execução
            {logs.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                viewAtual === "logs"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {logs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ══════════════════ MODO FORMULÁRIO ══════════════════ */}
      {viewAtual === "os" && modo === "formulario" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)]">

          {/* Campos */}
          {FormFields}

          {/* Alerta de conflito de horário */}
          {conflitosHorario.length > 0 && (
            <div className="mx-6 mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-destructive">Conflito de horário detectado</p>
                  <p className="text-xs text-destructive/80 mt-0.5 mb-3">
                    <span className="font-medium">{form.executante}</span> já tem{" "}
                    {conflitosHorario.length > 1 ? `${conflitosHorario.length} atividades registradas` : "uma atividade registrada"}{" "}
                    neste horário em <span className="font-medium">{fmtData(form.data_os)}</span>:
                  </p>
                  <div className="space-y-2">
                    {conflitosHorario.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 rounded-md bg-background border border-destructive/20 px-3 py-2">
                        <Clock className="h-3.5 w-3.5 text-destructive shrink-0" />
                        <span className="font-mono text-xs font-bold text-destructive whitespace-nowrap">
                          {c.hora_inicio} – {c.hora_fim}
                        </span>
                        <span className="text-border text-xs">·</span>
                        <span className="text-xs font-medium text-foreground shrink-0">{c.cliente_nome}</span>
                        <span className="text-border text-xs">·</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {c.tarefa.length > 60 ? c.tarefa.slice(0, 60) + "…" : c.tarefa}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-destructive/70 mt-3">Ajuste os horários para continuar.</p>
                </div>
              </div>
            </div>
          )}

          {/* Rodapé */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/20">
            <div className="text-[11px] text-muted-foreground">
              {isNovo
                ? "Inserindo novo registro"
                : (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1"><Pencil className="h-3 w-3" /> Editando registro</span>
                    {registroAtual?.criado_em && (
                      <span className="text-muted-foreground/60">
                        · Solicitado em {fmtDataHora(registroAtual.criado_em)}
                      </span>
                    )}
                  </span>
                )
              }
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (isNovo) setForm((p) => ({ ...FORM_VAZIO, executante: p.executante }));
                  else setIndiceAtual(indiceAtual); // re-dispara o effect
                }}
                className="px-4 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/30 transition-all"
              >
                {isNovo ? "Limpar" : "Desfazer"}
              </button>
              {podeApontarAutomatico && !isNovo && registroAtual && registroAtualProntoParaApontar && (
                <button
                  onClick={() => void executarApontamentoAutomatico([registroAtual])}
                  disabled={executandoApontamento}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {executandoApontamento ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {executandoApontamento ? "Apontando..." : "Apontar automático"}
                </button>
              )}
              <button
                onClick={handleSalvar}
                disabled={salvando}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {salvando ? "Salvando..." : isNovo ? "Salvar apontamento" : "Salvar alterações"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════ MODO GRADE ══════════════════ */}
      {viewAtual === "os" && modo === "grade" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ClipboardList className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">Apontamentos</p>
                {!loading && (
                  <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                    {total} registro{total !== 1 ? "s" : ""}{total !== totalGeral ? ` de ${totalGeral}` : ""}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 border border-primary/15">
                <Timer className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-primary font-mono">{decimalParaHHMM(totalHoras)}</span>
                <span className="text-[10px] text-primary/70">total</span>
              </div>
            </div>
          </div>

          <DataTable<Apontamento>
            columns={[
              ...(podeApontarAutomatico ? [{
                key: "apontamento_auto",
                header: "",
                width: 48,
                filterable: false,
                render: (_: unknown, row: Apontamento) => isApontamentoPronto(row) ? (
                  <input
                    type="checkbox"
                    checked={selecionadosApontamento.has(row.id)}
                    onChange={() => toggleSelecionadoApontamento(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground/40">-</span>
                ),
              }] : []),
              {
                key: "data_os", header: "Data", width: 90,
                render: (v) => <span className="font-mono">{fmtData(String(v))}</span>,
              },
              {
                key: "hora_inicio", header: "Hora Início", width: 90, filterable: false,
                render: (v) => (
                  <span className="font-mono text-muted-foreground">{fmtHora(String(v))}</span>
                ),
              },
              {
                key: "hora_fim", header: "Hora Fim", width: 90, filterable: false,
                render: (v) => (
                  <span className="font-mono text-muted-foreground">{fmtHora(String(v))}</span>
                ),
              },
              {
                key: "executante", header: "Executante", width: 130,
                render: (v) => <span className="font-medium block truncate">{String(v)}</span>,
              },
              {
                key: "cliente_nome", header: "Cliente", width: 150,
                render: (v) => <span className="font-medium block truncate">{String(v)}</span>,
              },
              {
                key: "tipo_atividade", header: "Tipo", width: 80, filterable: false,
                render: (v) => {
                  const opt = TIPO_ATIVIDADE_OPTIONS.find((o) => o.value === v) ?? TIPO_ATIVIDADE_OPTIONS[0];
                  return (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${opt.cor}`}>
                      {opt.label}
                    </span>
                  );
                },
              },
              {
                key: "ticket", header: "Ticket / OS", width: 110,
                render: (v) => <span className="font-mono text-muted-foreground">{v || "–"}</span>,
              },
              {
                key: "tarefa", header: "Tarefa", width: 220,
                render: (v) => <span className="block truncate">{String(v)}</span>,
              },
              {
                key: "horas_executadas", header: "Horas", width: 90, filterable: false,
                render: (v) => (
                  <span className="font-mono font-bold text-primary whitespace-nowrap">
                    {decimalParaHHMM(Number(v))}
                  </span>
                ),
              },
              ...(podeApontarAutomatico ? [{
                key: "url_tarefas",
                header: "URL Tarefas",
                width: 120,
                filterable: false,
                render: (_: unknown, row: Apontamento) => row.url_tarefas ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200">
                    <CheckCircle2 className="h-3 w-3" />
                    Configurada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                    <AlertTriangle className="h-3 w-3" />
                    Faltando
                  </span>
                ),
              }] : []),
              {
                key: "status_abertura", header: "Abertura", width: 130,
                render: (v) => {
                  const val = (v as string) ?? "OS Não Aberta";
                  return val === "OS Aberta" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      OS Aberta
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                      <Clock className="h-3 w-3" />
                      Não Aberta
                    </span>
                  );
                },
              },
              {
                key: "status_os", header: "Apontamento", width: 160,
                render: (v) => v === "OS Apontada" ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200">
                    <CheckCircle2 className="h-3 w-3" />
                    Apontada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                    <AlertTriangle className="h-3 w-3" />
                    Pendente
                  </span>
                ),
              },
              {
                key: "criado_em", header: "Solicitado em", width: 140, filterable: false,
                render: (v) => (
                  <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDataHora(String(v))}
                  </span>
                ),
              },
              {
                key: "id", header: "", width: 48, filterable: false,
                render: (_, row) => (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExcluir(row.id); }}
                    disabled={excluindoId === row.id}
                    title="Excluir"
                    className="text-muted-foreground/30 hover:text-destructive transition-colors disabled:opacity-50"
                  >
                    {excluindoId === row.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                ),
              },
            ] as ColumnDef<Apontamento>[]}
            data={apontamentosFiltrados}
            loading={loading}
            skeletonRows={6}
            onRowDoubleClick={(_, i) => abrirFormulario(i)}
            emptyMessage={busca || filtroStatus !== "todos"
              ? "Nenhum apontamento encontrado para este filtro."
              : "Nenhum apontamento registrado."}
            emptyAction={
              <button onClick={novoRegistro} className="mt-1 text-xs text-primary hover:underline">
                Criar primeiro apontamento
              </button>
            }
            footer={
              total > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {podeApontarAutomatico
                    ? "Marque as OS prontas para apontar ou dê duplo clique em uma linha para editar."
                    : "Duplo clique em uma linha para abrir o formulário de edição"}
                </span>
              ) : null
            }
          />
        </section>
      )}

      {/* ══════════════════ PAINEL DE LOGS ══════════════════ */}
      {/*
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Log de Operações</span>
            {logs.length > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {logs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                title="Limpar logs"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
              >
                <X className="h-3 w-3" /> Limpar
              </button>
            )}
            <button
              onClick={() => setLogAberto((v) => !v)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${logAberto ? "" : "-rotate-90"}`} />
            </button>
          </div>
        </div>

        {logAberto && (
          <div className="overflow-y-auto max-h-48 bg-[hsl(var(--background))]">
            {logs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50 p-4 text-center">Nenhum evento registrado ainda.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-2">
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap pt-0.5">{log.hora}</span>
                    <span className={`text-[10px] font-semibold uppercase whitespace-nowrap px-1.5 py-0.5 rounded pt-0 ${
                      log.tipo === "sucesso" ? "bg-green-100 text-green-700" :
                      log.tipo === "erro"    ? "bg-red-100 text-red-700" :
                      log.tipo === "aviso"   ? "bg-amber-100 text-amber-700" :
                                              "bg-blue-100 text-blue-700"
                    }`}>
                      {log.tipo}
                    </span>
                    <span className="text-[11px] text-foreground/80 leading-relaxed">{log.mensagem}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}
      */}

      {viewAtual === "logs" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Histórico de execuções</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {logs.length} evento{logs.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {logs.length > 0 && (
                <button
                  onClick={() => setLogs([])}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
                >
                  <X className="h-3 w-3" />
                  Limpar histórico
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto max-h-[420px] font-mono">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                <Terminal className="h-8 w-8 opacity-20" />
                <span className="text-xs">Nenhuma execução registrada ainda.</span>
                <span className="text-[11px] opacity-60">As operações desta tela aparecerão aqui.</span>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 px-5 py-3 transition-colors ${
                      log.tipo === "sucesso" ? "hover:bg-green-50/40" :
                      log.tipo === "erro"    ? "hover:bg-red-50/40" :
                      log.tipo === "aviso"   ? "hover:bg-amber-50/40" :
                                              "hover:bg-blue-50/40"
                    }`}
                  >
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap pt-0.5 min-w-[58px]">
                      {log.hora}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] font-bold uppercase whitespace-nowrap px-2 py-0.5 rounded-full ${
                      log.tipo === "sucesso" ? "bg-green-100 text-green-700" :
                      log.tipo === "erro"    ? "bg-red-100 text-red-700" :
                      log.tipo === "aviso"   ? "bg-amber-100 text-amber-700" :
                                              "bg-blue-100 text-blue-700"
                    }`}>
                      {log.tipo}
                    </span>
                    <span className="text-[11px] text-foreground/80 leading-relaxed">
                      {log.mensagem}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </section>
      )}
    </AppLayout>
  );
}
