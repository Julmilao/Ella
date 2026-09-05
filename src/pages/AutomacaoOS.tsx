import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { fetchAbas, fetchOS, fetchClientesSupabase, executarAutomacao, fetchExecStatus } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import FiltroAutomacaoOS, { type FiltroSalvo, aplicarFiltro } from "@/components/FiltroAutomacaoOS";
import {
  Rocket, Search, Loader2, RefreshCw,
  Terminal, X, CheckCircle2, XCircle, AlertCircle, ClipboardList,
  Database, Server, Filter, Circle,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type TipoLog = "sucesso" | "erro" | "aviso" | "info";

interface LogEntry {
  id: string;
  tipo: TipoLog;
  mensagem: string;
  hora: string;
  detalhe?: string;
  execucao_id: string | null;
  criado_em: string;
}

interface ExecucaoResumo {
  sucesso: number;
  falha: number;
  hora: string;
  execucao_id: string;
  em_andamento?: boolean;
}

type OSRow = Record<string, string>;

interface Apontamento {
  id: string;
  executante: string;
  cliente_id: string;
  cliente_nome: string;
  data_os: string;
  hora_inicio: string;
  hora_fim: string;
  ticket: string | null;
  tarefa: string;
  horas_executadas: number;
  status_os: string;
  status_abertura: string;
  observacoes: string | null;
}

type FonteDados = "backend" | "supabase";
type ViewAtual = "os" | "logs";

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

function normalizarTexto(valor: string): string {
  return valor
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarChaveCampo(valor: string): string {
  return normalizarTexto(valor).replace(/[^a-z0-9]/g, "");
}

function obterValorLinha(linha: OSRow, ...campos: string[]): string {
  const mapa = new Map<string, string>();

  Object.entries(linha).forEach(([chave, valor]) => {
    mapa.set(normalizarChaveCampo(chave), String(valor ?? ""));
  });

  for (const campo of campos) {
    const valor = mapa.get(normalizarChaveCampo(campo));
    if (valor !== undefined && valor.trim() !== "") return valor;
  }

  return "";
}

function obterExecutanteLinha(linha: OSRow): string {
  // obterValorLinha já normaliza as chaves (lowercase, sem acento, sem espaço)
  // então "Executante", "EXECUTANTE", "executante" são todos equivalentes a "executante"
  return obterValorLinha(
    linha,
    "executante",  // Executante, EXECUTANTE, executante
    "consultor",   // Consultor, CONSULTOR
    "executado",   // Executado, EXECUTADO
    "responsavel", // Responsável, Responsavel, RESPONSAVEL
    "colaborador", // Colaborador, COLABORADOR
    "coluna1",     // "Coluna 1", "COLUNA 1" (sem nome definido no Sheets)
    "nome",        // Nome, NOME (campo genérico)
  );
}

function isStatusAberturaPendente(valor: string): boolean {
  const status = normalizarTexto(valor);
  return status === "os nao aberta" || status === "erro";
}

// ── Normaliza Apontamento do Supabase → OSRow ─────────────────────────────────
function apontamentoParaRow(a: Apontamento): OSRow {
  return {
    executante:      a.executante,
    cliente:         a.cliente_nome,
    data_os:         a.data_os,
    hora_inicio:     a.hora_inicio,
    hora_fim:        a.hora_fim,
    ticket:          a.ticket ?? "–",
    tarefa:          a.tarefa,
    status_os:       a.status_os,
    status_abertura: a.status_abertura,
    horas:           decimalParaHHMM(a.horas_executadas),
    observacoes:     a.observacoes ?? "",
    _id:             a.id,
  };
}

// Colunas fixas da visão Supabase
const COLUNAS_SUPABASE = [
  "executante", "cliente", "data_os", "hora_inicio",
  "hora_fim", "ticket", "tarefa", "status_os", "status_abertura", "horas",
];

// Larguras padrão por coluna
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  executante: 130, cliente: 150, data_os: 90,
  hora_inicio: 90, hora_fim: 90, ticket: 100,
  tarefa: 200, status_os: 160, status_abertura: 150, horas: 70,
};

// Render de badge de status
function StatusBadge({ col, valor }: { col: string; valor: string }) {
  const v = normalizarTexto(valor);
  const colNorm = normalizarChaveCampo(col);
  let cls = "";

  if (colNorm === "statusexperience") {
    if (v === "pendente") cls = "bg-[hsl(var(--amber-light))] text-[hsl(var(--amber))]";
    else if (/lan.*ada/.test(v) || v.includes("apontada")) cls = "bg-[hsl(var(--green-light))] text-primary";
    else if (v === "erro") cls = "bg-[hsl(var(--red-light))] text-destructive";
  } else if (colNorm === "statusos") {
    if (v === "pendente apontamento") cls = "bg-[hsl(var(--amber-light))] text-[hsl(var(--amber))]";
    else if (v === "os apontada") cls = "bg-[hsl(var(--green-light))] text-primary";
    else if (v === "erro") cls = "bg-[hsl(var(--red-light))] text-destructive";
  } else if (colNorm === "statusabertura") {
    if (v === "os aberta" || v === "os lancada" || v === "os lançada") {
      cls = "bg-[hsl(var(--green-light))] text-primary";
    } else if (v === "os nao aberta" || v === "os não aberta") {
      cls = "bg-[hsl(var(--amber-light))] text-[hsl(var(--amber))]";
    } else if (v === "erro") {
      cls = "bg-[hsl(var(--red-light))] text-destructive";
    }
  }

  if (!cls) return <span className="block truncate">{valor}</span>;
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {valor}
    </span>
  );
}

// ── Helpers do painel de execução em tempo real ───────────────────────────────

const PASSOS_RPA = [
  { key: "browser",    label: "Preparando navegador",          pattern: /INICIANDO AUTOMACAO|Perfil temporario|Patches anti/i },
  { key: "login",      label: "Realizando login no Experience", pattern: /Navegando para https:\/\/login|Campo de e-mail detectado/i },
  { key: "autenticado",label: "Login realizado",               pattern: /Login (concluido|estabilizado)/i },
  { key: "empresa",    label: "Acessando empresa",             pattern: /PROCESSANDO EMPRESA:|Tela de gestao da OS detectada/i },
  { key: "os",         label: "Preenchendo formulário da OS",  pattern: /Lancando OS:|Abrindo formulario/i },
  { key: "salvando",   label: "Salvando no sistema",           pattern: /Acionando botao Salvar|Aguardando resposta do servidor/i },
  { key: "concluido",  label: "Concluindo",                    pattern: /RELATORIO FINAL|Total Sucesso/i },
];

type StepStatus = "pending" | "active" | "done";

function detectarPassos(logs: string[], status: string): { key: string; label: string; status: StepStatus }[] {
  let lastMatched = -1;
  const matched = new Set<number>();
  for (const line of logs) {
    for (let i = 0; i < PASSOS_RPA.length; i++) {
      if (PASSOS_RPA[i].pattern.test(line)) {
        matched.add(i);
        if (i > lastMatched) lastMatched = i;
      }
    }
  }
  if (status !== "running") lastMatched = PASSOS_RPA.length - 1;
  return PASSOS_RPA.map((p, i) => ({
    key: p.key,
    label: p.label,
    status: (matched.has(i) && (i < lastMatched || status !== "running"))
      ? "done"
      : (i === lastMatched && status === "running")
      ? "active"
      : "pending",
  }));
}

function extrairOsProcessadas(logs: string[]): { ticket: string; empresa: string; status: "running" | "success" | "error" }[] {
  const map: Record<string, { ticket: string; empresa: string; status: "running" | "success" | "error" }> = {};
  for (const line of logs) {
    const tag = line.match(/\[OS (\S+) \| ([^\]]+)\]/i);
    if (tag) {
      const [, ticket, empresa] = tag;
      if (!map[ticket]) map[ticket] = { ticket, empresa, status: "running" };
    }
    const suc = line.match(/^SUCESSO \|.*OS:\s*(\S+)/i);
    if (suc && map[suc[1]]) map[suc[1]].status = "success";
    const fail = line.match(/^FALHA \|.*OS:\s*(\S+)/i);
    if (fail && map[fail[1]]) map[fail[1]].status = "error";
  }
  return Object.values(map);
}

// Constrói ColumnDef[] a partir de uma lista de chaves
function buildColumns(keys: string[]): ColumnDef<OSRow>[] {
  return keys.map((key) => ({
    key,
    header: key,
    width: DEFAULT_COL_WIDTHS[key] ?? 120,
    render: (value: string) => <StatusBadge col={key} valor={String(value ?? "")} />,
  }));
}

export default function AutomacaoOS() {
  const { toast } = useToast();

  // ── Estado geral ──────────────────────────────────────────────────────────
  const [fonteDados, setFonteDados] = useState<FonteDados>("backend");

  // Backend
  const [dados, setDados] = useState<OSRow[]>([]);
  const [colunasFixas, setColunasFixas] = useState<string[]>([]);
  const [abaAtual, setAbaAtual] = useState<string>("");
  const [abas, setAbas] = useState<string[]>([]);

  // Supabase
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [loadingSupabase, setLoadingSupabase] = useState(false);
  const [filtroStatusSup, setFiltroStatusSup] = useState<string>("Pendente Apontamento");
  const [filtroAberturaSup, setFiltroAberturaSup] = useState<string>("OS Não Aberta");
  const [buscaSup, setBuscaSup] = useState("");
  const [filtroExecutanteSup, setFiltroExecutanteSup] = useState<string>("todos");
  const [filtroClienteSup, setFiltroClienteSup] = useState<string>("todos");

  // Compartilhados
  const [clientesMap, setClientesMap] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedRowObjects, setSelectedRowObjects] = useState<OSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [filtroAtivo, setFiltroAtivo] = useState<FiltroSalvo | null>(null);

  // Logs
  const [viewAtual, setViewAtual] = useState<ViewAtual>("os");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [ultimaExecucao, setUltimaExecucao] = useState<ExecucaoResumo | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Painel de execução em tempo real
  const [livePanel, setLivePanel] = useState<{
    open: boolean;
    execId: string | null;
    logs: string[];
    total: number;
    status: "running" | "done" | "error" | "not_found";
    resultado: any;
  }>({ open: false, execId: null, logs: [], total: 0, status: "running", resultado: null });
  const livePanelEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // ── Logs do banco ─────────────────────────────────────────────────────────
  const carregarLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const { data, error } = await supabase
        .from("logs")
        .select("*")
        .eq("modulo", "automacao_os")
        .order("criado_em", { ascending: false })
        .limit(300);
      if (error) throw error;
      const entries: LogEntry[] = (data ?? []).map((r: any) => ({
        id: r.id,
        tipo: r.tipo as TipoLog,
        mensagem: r.mensagem,
        hora: new Date(r.criado_em).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        detalhe: r.detalhe ?? undefined,
        execucao_id: r.execucao_id,
        criado_em: r.criado_em,
      }));
      setLogs(entries);
    } catch (err) {
      console.error("Erro ao carregar logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!ultimaExecucao?.em_andamento) return;

    const finalizacao = [...logs].reverse().find((log) =>
      log.execucao_id === ultimaExecucao.execucao_id &&
      (
        /Execucao finalizada|Execução finalizada/i.test(log.mensagem) ||
        /Execucao interrompida|Execução interrompida/i.test(log.mensagem) ||
        /Erro interno durante execucao/i.test(log.mensagem)
      )
    );

    if (finalizacao) {
      const match = finalizacao.mensagem.match(/Sucesso:\s*(\d+)\s*\|\s*Falha:\s*(\d+)/i);
      const falhaInterrompida = /interrompida|erro interno/i.test(finalizacao.mensagem);
      setUltimaExecucao((prev) =>
        prev && prev.execucao_id === ultimaExecucao.execucao_id
          ? {
              ...prev,
              sucesso: match ? Number(match[1]) : prev.sucesso,
              falha: match ? Number(match[2]) : falhaInterrompida ? Math.max(prev.falha, 1) : prev.falha,
              em_andamento: false,
            }
          : prev
      );
    }
  }, [logs, ultimaExecucao]);

  useEffect(() => {
    if (!ultimaExecucao?.em_andamento) return;
    const intervalId = window.setInterval(() => {
      carregarLogs();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [carregarLogs, ultimaExecucao?.em_andamento]);

  // ── Carrega dados do backend Python ──────────────────────────────────────
  const carregarDadosBackend = useCallback(async (aba?: string, force = false) => {
    setLoading(true);
    setSelectedRows(new Set());
    setSelectedRowObjects([]);
    try {
      const [osData, clientes, abasData] = await Promise.all([
        fetchOS(aba, force),
        fetchClientesSupabase(),
        abas.length ? Promise.resolve(abas) : fetchAbas(),
      ]);

      const todosDados = osData.dados || [];
      const filtered = todosDados.filter((linha) => obterExecutanteLinha(linha).trim() !== "");

      // Debug: se houver dados mas todos sem executante, loga as colunas dispon\u00edveis
      if (todosDados.length > 0 && filtered.length === 0) {
        const colunas = Object.keys(todosDados[0] || {}).filter(k => k !== "linha_id");
        console.warn(
          `[AutomacaoOS] Aba "${aba || osData.aba}": ${todosDados.length} linha(s) retornadas mas nenhuma tem executante.`,
          `Colunas dispon\u00edveis: ${colunas.join(", ")}`
        );
      }

      setDados(filtered);
      setAbaAtual(osData.aba || aba || "");
      if (!abas.length) setAbas(abasData);

      const normalizar = (s: string) =>
        s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const map: Record<string, string> = {};
      clientes.forEach((c) => { map[normalizar(c.empresa)] = c.experience_url_etapas; });
      setClientesMap(map);

      if (filtered.length) setColunasFixas(Object.keys(filtered[0]));
      else if (todosDados.length) setColunasFixas(Object.keys(todosDados[0]).filter(k => k !== "linha_id"));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [abas.length]);

  // ── Carrega apontamentos do Supabase ──────────────────────────────────────
  const carregarApontamentos = useCallback(async () => {
    setLoadingSupabase(true);
    setSelectedRows(new Set());
    setSelectedRowObjects([]);
    try {
      const { data, error } = await supabase
        .from("solicitacoes_os")
        .select("*, clientes(nome)")
        .order("data_os", { ascending: false })
        .order("hora_inicio", { ascending: false })
        .limit(500);
      if (error) throw error;

      const lista: Apontamento[] = (data ?? []).map((a: any) => ({
        ...a,
        cliente_nome: a.clientes?.nome ?? "–",
        hora_inicio: a.hora_inicio?.slice(0, 5) ?? "",
        hora_fim: a.hora_fim?.slice(0, 5) ?? "",
      }));
      setApontamentos(lista);

      const clientes = await fetchClientesSupabase();
      const normalizar = (s: string) =>
        s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const map: Record<string, string> = {};
      clientes.forEach((c) => { map[normalizar(c.empresa)] = c.experience_url_etapas; });
      setClientesMap(map);
    } catch (err) {
      console.error("Erro ao carregar apontamentos:", err);
    } finally {
      setLoadingSupabase(false);
    }
  }, []);

  // ── Inicializa conforme fonte ─────────────────────────────────────────────
  useEffect(() => {
    if (fonteDados === "backend") carregarDadosBackend();
    else carregarApontamentos();
    setSelectedRows(new Set());
    setSelectedRowObjects([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonteDados]);

  useEffect(() => {
    if (viewAtual === "logs") carregarLogs();
  }, [viewAtual, carregarLogs]);

  useEffect(() => {
    if (logsContainerRef.current) logsContainerRef.current.scrollTop = 0;
  }, [logs]);

  // ── Executantes e clientes únicos para dropdowns ──────────────────────────
  const executantesUnicos = useMemo(() =>
    [...new Set(apontamentos.map((a) => a.executante).filter(Boolean))].sort(),
  [apontamentos]);

  const clientesUnicos = useMemo(() =>
    [...new Set(apontamentos.map((a) => a.cliente_nome).filter((n) => n && n !== "–"))].sort(),
  [apontamentos]);

  // ── Dados normalizados ────────────────────────────────────────────────────
  const dadosNormalizados: OSRow[] = fonteDados === "backend"
    ? dados
    : apontamentos
        .filter((a) => {
          const termo = buscaSup.trim().toLowerCase();
          const matchBusca =
            !termo ||
            a.executante.toLowerCase().includes(termo) ||
            a.cliente_nome.toLowerCase().includes(termo) ||
            (a.ticket ?? "").toLowerCase().includes(termo) ||
            a.tarefa.toLowerCase().includes(termo);
          const matchStatus = !filtroStatusSup || a.status_os === filtroStatusSup;
          const matchAbertura = !filtroAberturaSup
            || (normalizarTexto(filtroAberturaSup) === "os nao aberta"
              ? isStatusAberturaPendente(a.status_abertura)
              : a.status_abertura === filtroAberturaSup);
          const matchExecutante = filtroExecutanteSup === "todos" || a.executante === filtroExecutanteSup;
          const matchCliente = filtroClienteSup === "todos" || a.cliente_nome === filtroClienteSup;
          return matchBusca && matchStatus && matchAbertura && matchExecutante && matchCliente;
        })
        .map(apontamentoParaRow);

  const isLoadingAtual = fonteDados === "backend" ? loading : loadingSupabase;

  // Aplica filtro salvo (regras AND) sobre os dados já normalizados
  const dadosFiltrados = useMemo<OSRow[]>(() => {
    if (!filtroAtivo?.regras?.length) return dadosNormalizados;
    return dadosNormalizados.filter((row) => aplicarFiltro(row as Record<string, unknown>, filtroAtivo.regras));
  }, [dadosNormalizados, filtroAtivo]);

  // Colunas disponíveis para o construtor de filtros
  const colunasParaFiltro = fonteDados === "backend" ? colunasFixas : COLUNAS_SUPABASE;

  // ── Column defs para DataTable ─────────────────────────────────────────────
  const columns = useMemo<ColumnDef<OSRow>[]>(() => {
    const keys = fonteDados === "backend" ? colunasFixas : COLUNAS_SUPABASE;
    return buildColumns(keys);
  }, [fonteDados, colunasFixas]);

  // Predicado de seleção
  const canSelect = useCallback((row: OSRow) => {
    if (fonteDados === "backend") {
      const statusExperience = normalizarTexto(
        obterValorLinha(row, "Status experience", "Status Experience")
      );
      return statusExperience === "pendente";
    }
    // Supabase: só seleciona OS pendentes que ainda não foram abertas pelo RPA
    return (
      row["status_os"] === "Pendente Apontamento" &&
      isStatusAberturaPendente(row["status_abertura"])
    );
  }, [fonteDados]);

  // ── Polling de logs em tempo real ────────────────────────────────────────
  useEffect(() => {
    if (!livePanel.open || !livePanel.execId || livePanel.status !== "running") return;
    const id = livePanel.execId;
    let cancelled = false;
    let after = 0;

    const poll = async () => {
      let semResposta = 0;
      while (!cancelled) {
        const data = await fetchExecStatus(id, after);
        if (cancelled) break;
        if (!data || data.status === "not_found") {
          semResposta++;
          // servidor reiniciou — para de tentar após 3 tentativas sem resposta
          if (semResposta >= 3) {
            setLivePanel((prev) => ({ ...prev, status: "error" }));
            break;
          }
        } else {
          semResposta = 0;
          after = data.total;
          setLivePanel((prev) => ({
            ...prev,
            logs: [...prev.logs, ...data.logs],
            total: data.total,
            status: data.status as any,
            resultado: data.resultado ?? prev.resultado,
          }));
          if (data.status !== "running") break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [livePanel.open, livePanel.execId, livePanel.status]);

  useEffect(() => {
    livePanelEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [livePanel.logs]);

  // ── Execução da automação ─────────────────────────────────────────────────
  const handleExecutar = async () => {
    if (!selectedRowObjects.length) return;

    setExecuting(true);
    const execucao_id = crypto.randomUUID();
    const { data: { user } } = await supabase.auth.getUser();
    const usuario_id = user?.id ?? null;

    try {
      const normalizar = (s: string) =>
        (s || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const payload = selectedRowObjects.map((linha) => {
        const empresa = obterValorLinha(linha, "cliente", "Cliente");
        const empresaKey = normalizar(empresa);
        const experience_url_etapas = clientesMap[empresaKey];
        if (!experience_url_etapas) {
          throw new Error(
            `Empresa "${linha["cliente"]}" não tem URL configurada — verifique o Painel Admin → Clientes`
          );
        }

        if (fonteDados === "backend") {
          return {
            aba: abaAtual,
            empresa,
            usuario: obterExecutanteLinha(linha),
            data: obterValorLinha(linha, "Data"),
            hora_inicio: obterValorLinha(linha, "Hora inicio", "Hora Início"),
            hora_fim: obterValorLinha(linha, "Hora fim", "Hora Fim"),
            ticket: obterValorLinha(linha, "Tarefa", "Ticket/OS"),
            experience_url_etapas,
            linha_id: linha["linha_id"],
          };
        } else {
          return {
            aba: "",
            empresa: linha["cliente"],
            usuario: linha["executante"],
            data: linha["data_os"],
            hora_inicio: linha["hora_inicio"],
            hora_fim: linha["hora_fim"],
            ticket: linha["ticket"] !== "–" ? linha["ticket"] : "",
            experience_url_etapas,
            apontamento_id: linha["_id"],
          };
        }
      });

      const res = await executarAutomacao(payload, execucao_id, usuario_id);

      // Abre painel de execução em tempo real
      setLivePanel({ open: true, execId: execucao_id, logs: [], total: 0, status: "running", resultado: null });

      const sucessos: any[] = res.sucesso ?? [];
      const falhas: any[] = res.falha ?? [];

      const hora = new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      setUltimaExecucao({
        sucesso: sucessos.length,
        falha: falhas.length,
        hora,
        execucao_id,
        em_andamento: Boolean(res.em_andamento),
      });

      await carregarLogs();
      setViewAtual("logs");

      if (fonteDados === "backend") carregarDadosBackend(abaAtual);
      else carregarApontamentos();
    } catch (err: any) {
      const mensagemErro = err.message || "Erro desconhecido";
      toast({
        title: "Erro ao executar automação",
        description: mensagemErro,
        variant: "destructive",
      });
      await supabase.from("logs").insert({
        modulo: "automacao_os",
        execucao_id,
        tipo: "erro",
        mensagem: `Erro ao executar automação — ${mensagemErro}`,
        usuario_id,
      });
      await carregarLogs();
      setViewAtual("logs");
    } finally {
      setExecuting(false);
    }
  };

  // ── Rótulo do subtítulo ───────────────────────────────────────────────────
  const subtitulo = fonteDados === "backend"
    ? `Aba ativa: ${abaAtual || "–"}`
    : `Banco de dados · ${apontamentos.length} registro(s)`;

  // Valores derivados para o card de execução em tempo real
  const livePassos   = detectarPassos(livePanel.logs, livePanel.status);
  const liveOsItems  = extrairOsProcessadas(livePanel.logs);
  const liveSucesso  = livePanel.resultado?.sucesso?.length ?? 0;
  const liveFalhas   = livePanel.resultado?.falha?.length ?? 0;
  const liveIsDone   = livePanel.status !== "running";
  const liveIsErro   = livePanel.status === "error";

  return (
    <AppLayout title="Abertura Automática" subtitle={subtitulo}>

      {/* ── Toggle de fonte de dados ── */}
      <section className="bg-card border border-border rounded-xl p-3 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono mr-1">
            Fonte de dados
          </span>

          <button
            onClick={() => setFonteDados("backend")}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              fonteDados === "backend"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-border"
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            Backend / Google Sheets
          </button>

          <button
            onClick={() => setFonteDados("supabase")}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              fonteDados === "supabase"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-border"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Banco de dados (Lançamentos)
          </button>

          {fonteDados === "supabase" && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* Busca */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={buscaSup}
                  onChange={(e) => { setBuscaSup(e.target.value); setSelectedRows(new Set()); setSelectedRowObjects([]); }}
                  placeholder="Buscar..."
                  className="pl-8 pr-7 h-8 text-xs w-44 bg-background border-border"
                />
                {buscaSup && (
                  <button
                    onClick={() => { setBuscaSup(""); setSelectedRows(new Set()); setSelectedRowObjects([]); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Executante */}
              <Select value={filtroExecutanteSup} onValueChange={(v) => { setFiltroExecutanteSup(v); setSelectedRows(new Set()); setSelectedRowObjects([]); }}>
                <SelectTrigger className="h-8 text-xs w-40 bg-background border-border">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Executante" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos executantes</SelectItem>
                  {executantesUnicos.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Cliente */}
              <Select value={filtroClienteSup} onValueChange={(v) => { setFiltroClienteSup(v); setSelectedRows(new Set()); setSelectedRowObjects([]); }}>
                <SelectTrigger className="h-8 text-xs w-44 bg-background border-border">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos clientes</SelectItem>
                  {clientesUnicos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Filtro por status OS */}
              <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-background">
                {(["Pendente Apontamento", "OS Apontada", ""] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setFiltroStatusSup(s); setSelectedRows(new Set()); setSelectedRowObjects([]); }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      filtroStatusSup === s
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s === "" ? "Todos status" : s}
                  </button>
                ))}
              </div>

              {/* Filtro por status de abertura */}
              <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-background">
                {([
                  { val: "OS Não Aberta", label: "Pendente / Reprocessar" },
                  { val: "OS Aberta",     label: "Aberta (RPA)" },
                  { val: "",              label: "Todas abertura" },
                ] as const).map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => { setFiltroAberturaSup(val); setSelectedRows(new Set()); setSelectedRowObjects([]); }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      filtroAberturaSup === val
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {fonteDados === "backend" && abas.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border">
            {abas.map((aba) => (
              <button
                key={aba}
                onClick={() => carregarDadosBackend(aba)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  aba === abaAtual
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {aba}
              </button>
            ))}
            {abaAtual && (
              <button
                onClick={() => carregarDadosBackend(abaAtual, true)}
                disabled={loading}
                title="Buscar dados frescos da planilha (ignora cache)"
                className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Server className="h-3 w-3" />}
                Atualizar planilha
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Actions + Sub-tabs ── */}
      <section className="bg-card border border-border rounded-xl p-3 shadow-[var(--shadow-sm)] flex flex-wrap items-center gap-2">
        <button
          onClick={handleExecutar}
          disabled={executing || selectedRows.size === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {executing ? "Executando..." : "Executar lançamentos"}
        </button>

        <button
          onClick={() => window.open("/saldo-horas", "_self")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-xs hover:bg-[hsl(var(--green-light))] transition-all"
        >
          <Search className="h-3.5 w-3.5" />
          Saldo de horas
        </button>

        {selectedRows.size > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {selectedRows.size} selecionada{selectedRows.size > 1 ? "s" : ""}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <FiltroAutomacaoOS
            colunasDisponiveis={colunasParaFiltro}
            filtroAtivo={filtroAtivo}
            onFiltroChange={(f) => { setFiltroAtivo(f); setSelectedRows(new Set()); setSelectedRowObjects([]); }}
          />
        </div>

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
      </section>

      {/* ══════════════════ VIEW: OS ══════════════════ */}
      {viewAtual === "os" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
          <DataTable<OSRow>
            key={`${fonteDados}-${abaAtual}`}
            columns={columns}
            data={dadosFiltrados}
            loading={isLoadingAtual}
            selectable
            canSelect={canSelect}
            selectedRows={selectedRows}
            onSelectionChange={(indices, rows) => {
              setSelectedRows(indices);
              setSelectedRowObjects(rows);
            }}
            emptyMessage={
              fonteDados === "supabase"
                ? "Nenhum apontamento encontrado com este filtro"
                : "Nenhum dado disponível"
            }
            footer={
              !isLoadingAtual ? (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {dadosFiltrados.length > 0
                      ? <>
                          {dadosFiltrados.length} registro{dadosFiltrados.length !== 1 ? "s" : ""}
                          {filtroAtivo && dadosNormalizados.length !== dadosFiltrados.length && (
                            <span className="text-muted-foreground/60"> de {dadosNormalizados.length}</span>
                          )}
                          {fonteDados === "supabase" && (() => {
                            const naoAbertas = apontamentos.filter(
                              (a) => a.status_os === "Pendente Apontamento" && isStatusAberturaPendente(a.status_abertura)
                            ).length;
                            const abertas = apontamentos.filter(
                              (a) => a.status_os === "Pendente Apontamento" && a.status_abertura === "OS Aberta"
                            ).length;
                            return ` · ${naoAbertas} aguardando RPA · ${abertas} aberta${abertas !== 1 ? "s" : ""} pelo RPA`;
                          })()}
                        </>
                      : null}
                  </span>
                  <button
                    onClick={() => fonteDados === "backend"
                      ? carregarDadosBackend(abaAtual, true)
                      : carregarApontamentos()
                    }
                    disabled={isLoadingAtual}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/60 disabled:opacity-40"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Atualizar
                  </button>
                </div>
              ) : null
            }
          />
        </section>
      )}

      {/* ══════════════════ VIEW: LOG DE EXECUÇÃO ══════════════════ */}
      {viewAtual === "logs" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">

          {ultimaExecucao && (
            <div className={`flex items-center justify-between px-5 py-3 border-b border-border ${
              ultimaExecucao.em_andamento
                ? "bg-blue-50 border-blue-200"
                : ultimaExecucao.falha === 0
                ? "bg-green-50 border-green-200"
                : ultimaExecucao.sucesso === 0
                  ? "bg-red-50 border-red-200"
                  : "bg-amber-50 border-amber-200"
            }`}>
              <div className="flex items-center gap-3">
                {ultimaExecucao.em_andamento
                  ? <Loader2 className="h-4 w-4 text-blue-600 shrink-0 animate-spin" />
                  : ultimaExecucao.falha === 0
                  ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  : ultimaExecucao.sucesso === 0
                    ? <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                    : <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                }
                <div>
                  <p className={`text-xs font-semibold ${
                    ultimaExecucao.em_andamento ? "text-blue-800" :
                    ultimaExecucao.falha === 0 ? "text-green-800" :
                    ultimaExecucao.sucesso === 0 ? "text-red-800" : "text-amber-800"
                  }`}>
                    {ultimaExecucao.em_andamento
                      ? `Automação em andamento · iniciada às ${ultimaExecucao.hora}`
                      : `Automação encerrada · log gerado às ${ultimaExecucao.hora}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {ultimaExecucao.em_andamento ? (
                      "Acompanhe o resultado final nos logs abaixo."
                    ) : (
                      <>
                        <span className="text-green-700 font-semibold">
                          {ultimaExecucao.sucesso} sucesso{ultimaExecucao.sucesso !== 1 ? "s" : ""}
                        </span>
                        {" · "}
                        <span className={`font-semibold ${ultimaExecucao.falha > 0 ? "text-red-700" : "text-muted-foreground"}`}>
                          {ultimaExecucao.falha} falha{ultimaExecucao.falha !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setUltimaExecucao(null)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Histórico de execuções</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {logs.length} eventos
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={carregarLogs}
                disabled={loadingLogs}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/60"
              >
                {loadingLogs ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Atualizar
              </button>
              {logs.length > 0 && (
                <button
                  onClick={async () => {
                    await supabase.from("logs").delete().eq("modulo", "automacao_os");
                    setLogs([]);
                    setUltimaExecucao(null);
                  }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
                >
                  <X className="h-3 w-3" /> Limpar histórico
                </button>
              )}
            </div>
          </div>

          <div ref={logsContainerRef} className="overflow-y-auto max-h-[480px] font-mono">
            {loadingLogs ? (
              <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs">Carregando histórico...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                <Terminal className="h-8 w-8 opacity-20" />
                <span className="text-xs">Nenhuma execução registrada ainda.</span>
                <span className="text-[11px] opacity-60">Execute lançamentos e o relatório aparecerá aqui.</span>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 px-5 py-3 ${
                      log.tipo === "sucesso" ? "hover:bg-green-50/40" :
                      log.tipo === "erro"    ? "hover:bg-red-50/40" :
                      log.tipo === "aviso"   ? "hover:bg-amber-50/40" : "hover:bg-blue-50/40"
                    } transition-colors`}
                  >
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap pt-0.5 min-w-[58px]">
                      {log.hora}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] font-bold whitespace-nowrap px-2 py-0.5 rounded-full ${
                      log.tipo === "sucesso" ? "bg-green-100 text-green-700" :
                      log.tipo === "erro"    ? "bg-red-100 text-red-700" :
                      log.tipo === "aviso"   ? "bg-amber-100 text-amber-700" :
                                              "bg-blue-100 text-blue-700"
                    }`}>
                      {log.tipo === "sucesso" && <CheckCircle2 className="h-3 w-3" />}
                      {log.tipo === "erro"    && <XCircle className="h-3 w-3" />}
                      {log.tipo === "aviso"   && <AlertCircle className="h-3 w-3" />}
                      {log.tipo.toUpperCase()}
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[11px] text-foreground/80 leading-relaxed break-words">
                        {log.mensagem}
                      </span>
                      {log.detalhe && (
                        <span className="text-[11px] text-red-600 font-medium">↳ {log.detalhe}</span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══════════════════ CARD DE EXECUÇÃO EM TEMPO REAL ══════════════════ */}
      {livePanel.open && (
        <div className="fixed bottom-5 right-5 z-50 w-80">
          <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">

            {/* Header */}
            <div className={`px-5 py-4 border-b border-border flex items-center gap-3 ${
              !liveIsDone ? "bg-blue-50/60" : liveIsErro || liveFalhas > 0 ? "bg-red-50/60" : "bg-green-50/60"
            }`}>
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                !liveIsDone ? "bg-blue-100" : liveIsErro || liveFalhas > 0 ? "bg-red-100" : "bg-green-100"
              }`}>
                {!liveIsDone
                  ? <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                  : liveIsErro || liveFalhas > 0
                  ? <XCircle className="h-4 w-4 text-red-600" />
                  : <CheckCircle2 className="h-4 w-4 text-green-600" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {!liveIsDone ? "Automação em andamento" : liveIsErro ? "Erro na execução" : liveFalhas > 0 ? "Concluído com falhas" : "Concluído com sucesso"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {!liveIsDone ? "Aguarde enquanto processamos as OS..." : `${liveSucesso} OS aberta${liveSucesso !== 1 ? "s" : ""} · ${liveFalhas} falha${liveFalhas !== 1 ? "s" : ""}`}
                </p>
              </div>
              {liveIsDone && (
                <button onClick={() => setLivePanel((p) => ({ ...p, open: false }))} className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded transition-colors">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Passos */}
            <div className="px-5 py-4 space-y-3">
              {livePassos.map((passo) => (
                <div key={passo.key} className="flex items-center gap-3">
                  {passo.status === "done"
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : passo.status === "active"
                    ? <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                    : <Circle className="h-4 w-4 text-muted-foreground/25 shrink-0" />
                  }
                  <span className={`text-sm leading-tight ${
                    passo.status === "done"   ? "text-foreground" :
                    passo.status === "active" ? "text-blue-600 font-medium" :
                    "text-muted-foreground/40"
                  }`}>
                    {passo.label}
                  </span>
                </div>
              ))}
            </div>

            {/* OS em processamento */}
            {liveOsItems.length > 0 && (
              <div className="px-5 pb-4 border-t border-border/50 pt-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">OS processadas</p>
                {liveOsItems.map((os) => (
                  <div key={os.ticket} className="flex items-center gap-2">
                    {os.status === "success"
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : os.status === "error"
                      ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      : <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
                    }
                    <span className="text-xs text-foreground font-medium">{os.ticket}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground truncate">{os.empresa}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Falhas detalhadas */}
            {liveIsDone && liveFalhas > 0 && livePanel.resultado?.falha && (
              <div className="px-5 pb-4 space-y-1">
                {livePanel.resultado.falha.map((f: any, i: number) => (
                  <p key={i} className="text-xs text-red-600 leading-snug">
                    {f.empresa || f.ticket ? `${f.empresa ?? ""} ${f.ticket ?? ""}`.trim() : "OS"}: {String(f.motivo ?? "").slice(0, 80)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
