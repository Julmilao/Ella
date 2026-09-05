import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { fetchAbas, fetchOS } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Clock,
  Building2,
  Activity,
  TrendingUp,
  Search,
  Loader2,
  BarChart3,
  User,
  Download,
  FileSpreadsheet,
  FileText,
  X,
  Database,
  Server,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import {
  parsearHoras,
  minParaDisplay,
  agruparPorEmpresa,
  calcularResumo,
  formatarAba,
  type OSRow,
} from "@/services/exportHelpers";
import { exportarExcelGeral, exportarExcelPorEmpresa } from "@/services/exportExcel";
import { exportarPDF } from "@/services/exportPDF";

const GREEN_PAL = [
  "#2e7d32", "#43a047", "#66bb6a", "#81c784", "#a5d6a7",
  "#1b5e20", "#388e3c", "#00c853", "#69f0ae", "#b9f6ca",
  "#33691e", "#558b2f", "#7cb342", "#9ccc65", "#aed581",
];

type FonteDados = "backend" | "supabase";

interface EmpresaResumo {
  empresa: string;
  linhas: OSRow[];
  totalMinutos: number;
  quantidade: number;
}

interface ApontamentoStatusReport {
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
}

interface ContratoVsConsumo {
  cliente_id: string;
  cliente_nome: string;
  horas_contratadas: number;
  horas_consumidas: number;
  saldo: number;
  pct: number;
  sustentacao_desde: string | null;
  status_sustentacao: string;
}

interface KpiCardData {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  color: string;
  surface?: string;
  progress?: number;
  progressClass?: string;
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
    if (valor && valor.trim() !== "") return valor;
  }

  return "";
}

function obterExecutanteLinha(linha: OSRow): string {
  return obterValorLinha(linha, "executante", "Executante", "Consultor");
}

function calcularExecutadoPorHorario(inicio: string, fim: string): string {
  if (!inicio || !fim || !inicio.includes(":") || !fim.includes(":")) return "";

  const [hInicio, mInicio] = inicio.split(":").map(Number);
  const [hFim, mFim] = fim.split(":").map(Number);
  if ([hInicio, mInicio, hFim, mFim].some((valor) => Number.isNaN(valor))) return "";

  const minutosInicio = hInicio * 60 + mInicio;
  const minutosFim = hFim * 60 + mFim;
  if (minutosFim <= minutosInicio) return "";

  return minParaDisplay(minutosFim - minutosInicio);
}

function formatarDataBanco(data: string): string {
  if (!data) return "";
  const [ano, mes, dia] = data.split("-");
  if (!ano || !mes || !dia) return data;
  return `${dia}/${mes}/${ano}`;
}

function periodoDaData(data: string): string {
  if (!data || data.length < 7) return "";
  const [ano, mes] = data.split("-");
  if (!ano || !mes) return "";
  return `${mes}${ano}`;
}

function compararPeriodoDesc(a: string, b: string): number {
  const anoA = Number(a.slice(2));
  const mesA = Number(a.slice(0, 2));
  const anoB = Number(b.slice(2));
  const mesB = Number(b.slice(0, 2));

  if (anoA !== anoB) return anoB - anoA;
  return mesB - mesA;
}

// "042026" → "2026-04"
function periodoParaMesRef(periodo: string): string {
  if (periodo.length !== 6) return "";
  return `${periodo.slice(2)}-${periodo.slice(0, 2)}`;
}

function decimalParaHHMM(valor: number): string {
  if (!Number.isFinite(valor) || valor <= 0) return "0h";
  return minParaDisplay(Math.round(valor * 60));
}

function limitarPct(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.max(0, Math.min(Math.round(valor), 100));
}

function obterStatusContratoVisual(horasContratadas: number, pct: number) {
  if (horasContratadas === 0) {
    return {
      label: "Sem contrato",
      color: "text-muted-foreground",
      bg: "bg-muted/40",
      dot: "bg-muted-foreground",
      chip: "bg-muted/70 text-muted-foreground",
      panel: "border-border bg-[linear-gradient(135deg,rgba(247,250,247,0.96),rgba(255,255,255,0.98))]",
      progress: "bg-muted-foreground/60",
      headline: "Contrato mensal ainda nao cadastrado para este recorte.",
    };
  }

  if (pct >= 100) {
    return {
      label: "Crítico",
      color: "text-destructive",
      bg: "bg-destructive/10",
      dot: "bg-destructive",
      chip: "bg-destructive/10 text-destructive",
      panel: "border-destructive/20 bg-[linear-gradient(135deg,rgba(254,242,242,0.96),rgba(255,255,255,0.98))]",
      progress: "bg-gradient-to-r from-red-500 to-red-600",
      headline: "O consumo ultrapassou o limite contratado e exige acao imediata.",
    };
  }

  if (pct >= 80) {
    return {
      label: "Atenção",
      color: "text-amber-700",
      bg: "bg-amber-50",
      dot: "bg-amber-500",
      chip: "bg-amber-100 text-amber-700",
      panel: "border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))]",
      progress: "bg-gradient-to-r from-amber-400 to-amber-500",
      headline: "O contrato esta em zona de alerta e merece acompanhamento proximo.",
    };
  }

  return {
    label: "Saudável",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    dot: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-700",
    panel: "border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    progress: "bg-gradient-to-r from-emerald-500 to-green-600",
    headline: "O consumo segue dentro do ritmo esperado para o contrato atual.",
  };
}

function normalizarLinhaPlanilha(linha: OSRow): OSRow {
  const horaInicio = obterValorLinha(linha, "Hora inicio", "Hora InÃ­cio", "hora_inicio");
  const horaFim = obterValorLinha(linha, "Hora fim", "Hora Fim", "hora_fim");
  const executado = obterValorLinha(linha, "Executado", "executado") || calcularExecutadoPorHorario(horaInicio, horaFim);
  return {
    ...linha,
    cliente: obterValorLinha(linha, "cliente", "Cliente"),
    executante: obterExecutanteLinha(linha),
    Tarefa: obterValorLinha(linha, "Tarefa", "tarefa"),
    Data: obterValorLinha(linha, "Data", "data_os"),
    "Hora fim": horaFim,
    Executado: executado,
    "Hora inicio": obterValorLinha(linha, "Hora inicio", "Hora Início", "hora_inicio"),
  };
}

function apontamentoParaLinha(a: ApontamentoStatusReport): OSRow {
  return {
    _id: a.id,
    cliente: a.cliente_nome,
    executante: a.executante,
    Tarefa: a.tarefa,
    Data: formatarDataBanco(a.data_os),
    "Hora inicio": a.hora_inicio,
    "Hora fim": a.hora_fim,
    Executado: decimalParaHHMM(Number(a.horas_executadas || 0)),
    ticket: a.ticket ?? "",
    data_os: a.data_os,
    horas_executadas: String(a.horas_executadas || 0),
    status_os: a.status_os,
  };
}

function filtrarLinhasPlanilhaStatusReport(dados: OSRow[]): OSRow[] {
  return dados
    .filter((linha) => {
      const executante = obterExecutanteLinha(linha);
      const cliente = obterValorLinha(linha, "cliente", "Cliente");
      const tarefa = obterValorLinha(linha, "Tarefa", "tarefa");
      const executado = obterValorLinha(linha, "Executado", "executado").trim();
      const horaInicio = obterValorLinha(linha, "Hora inicio", "Hora Início", "hora_inicio");
      const horaFim = obterValorLinha(linha, "Hora fim", "Hora Fim", "hora_fim");

      if (!executante || !cliente || !tarefa) return false;

      if (executado && !["0", "0:00", "00:00", "0.00"].includes(executado)) {
        return true;
      }

      return Boolean(horaInicio && horaFim);
    })
    .map(normalizarLinhaPlanilha);
}

function ModalExport({
  resumo,
  modo,
  periodoAtual,
  dadosGlobais,
  onClose,
}: {
  resumo: EmpresaResumo[];
  modo: "excel" | "pdf";
  periodoAtual: string;
  dadosGlobais: OSRow[];
  onClose: () => void;
}) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(
    new Set(resumo.map((r) => r.empresa))
  );
  const [exportando, setExportando] = useState(false);

  const toggle = (empresa: string) =>
    setSelecionadas((prev) => {
      const next = new Set(prev);
      next.has(empresa) ? next.delete(empresa) : next.add(empresa);
      return next;
    });

  const handleExportar = async () => {
    setExportando(true);
    const filtro = [...selecionadas];
    try {
      if (modo === "pdf") {
        await exportarPDF(dadosGlobais, periodoAtual, filtro);
      } else {
        exportarExcelPorEmpresa(dadosGlobais, periodoAtual, filtro);
      }
    } finally {
      setExportando(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {modo === "pdf" ? "Exportar PDF" : "Exportar Excel"} por empresa
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {selecionadas.size} de {resumo.length} selecionadas
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 px-5 py-2 border-b border-border/50">
          <button
            onClick={() => setSelecionadas(new Set(resumo.map((r) => r.empresa)))}
            className="text-[11px] text-primary hover:underline"
          >
            Selecionar todas
          </button>
          <span className="text-muted-foreground">.</span>
          <button
            onClick={() => setSelecionadas(new Set())}
            className="text-[11px] text-muted-foreground hover:underline"
          >
            Desmarcar todas
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {resumo.map((r) => {
            const res = calcularResumo(r.linhas);
            return (
              <label
                key={r.empresa}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selecionadas.has(r.empresa)}
                  onChange={() => toggle(r.empresa)}
                  className="accent-primary h-4 w-4"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.empresa}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {res.qtd} atividade{res.qtd !== 1 ? "s" : ""} · {minParaDisplay(res.minutos)}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/30"
          >
            Cancelar
          </button>
          <button
            onClick={handleExportar}
            disabled={selecionadas.size === 0 || exportando}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {exportando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {exportando ? "Exportando..." : `Exportar ${selecionadas.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StatusReport() {
  const [fonteDados, setFonteDados] = useState<FonteDados>("backend");
  const [abas, setAbas] = useState<string[]>([]);
  const [abaAtual, setAbaAtual] = useState<string>("");
  const [dadosPlanilha, setDadosPlanilha] = useState<OSRow[]>([]);
  const [apontamentosBanco, setApontamentosBanco] = useState<ApontamentoStatusReport[]>([]);
  const [dadosBanco, setDadosBanco] = useState<OSRow[]>([]);
  const [periodosBanco, setPeriodosBanco] = useState<string[]>([]);
  const [periodoBancoAtual, setPeriodoBancoAtual] = useState<string>("");
  const [resumo, setResumo] = useState<EmpresaResumo[]>([]);
  const [totalMinutosGeral, setTotalMinutosGeral] = useState(0);
  const [empresaAtiva, setEmpresaAtiva] = useState<EmpresaResumo | null>(null);
  const [buscaAtividade, setBuscaAtividade] = useState("");
  const [loadingPlanilha, setLoadingPlanilha] = useState(true);
  const [loadingBanco, setLoadingBanco] = useState(false);
  const [contratosComparacao, setContratosComparacao] = useState<ContratoVsConsumo[]>([]);
  const [loadingContratos, setLoadingContratos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [exportDropdown, setExportDropdown] = useState(false);
  const [modal, setModal] = useState<{ aberto: boolean; modo: "excel" | "pdf" }>({
    aberto: false,
    modo: "excel",
  });

  const abrirModal = (modo: "excel" | "pdf") => {
    setExportDropdown(false);
    setModal({ aberto: true, modo });
  };

  const montar = useCallback((dados: OSRow[]) => {
    const porEmpresa = agruparPorEmpresa(dados);
    const res = Object.entries(porEmpresa)
      .map(([empresa, linhas]) => ({
        empresa,
        linhas,
        totalMinutos: linhas.reduce((acc, l) => acc + parsearHoras(l["Executado"] || "0:00"), 0),
        quantidade: linhas.length,
      }))
      .sort((a, b) => b.totalMinutos - a.totalMinutos);

    setResumo(res);
    setTotalMinutosGeral(res.reduce((acc, item) => acc + item.totalMinutos, 0));
  }, []);

  const aplicarFiltroBanco = useCallback((lista: ApontamentoStatusReport[], periodo: string) => {
    const filtrados = periodo
      ? lista.filter((item) => periodoDaData(item.data_os) === periodo)
      : lista;

    setDadosBanco(filtrados.map(apontamentoParaLinha));
  }, []);

  const carregarDadosPlanilha = useCallback(async (aba?: string) => {
    setLoadingPlanilha(true);
    setErro(null);

    try {
      const json = await fetchOS(aba);
      const dados = filtrarLinhasPlanilhaStatusReport(json.dados || []);

      setDadosPlanilha(dados);
      setAbaAtual(json.aba || aba || "");
    } catch (e) {
      console.error("Erro ao carregar dados da planilha:", e);
      setErro("Nao foi possivel carregar os dados da planilha.");
      setDadosPlanilha([]);
    } finally {
      setLoadingPlanilha(false);
    }
  }, []);

  const carregarAbas = useCallback(async (abaPreferida?: string) => {
    try {
      const abasData = await fetchAbas();
      const abasPeriodo = abasData
        .filter((aba) => /^\d{6}$/.test(aba))
        .sort(compararPeriodoDesc);
      const abasValidas = abasPeriodo.length > 0 ? abasPeriodo : abasData;

      setAbas(abasValidas);

      const abaInicial =
        abaPreferida && abasValidas.includes(abaPreferida)
          ? abaPreferida
          : abasValidas[0];

      await carregarDadosPlanilha(abaInicial);
    } catch (e) {
      console.error("Erro ao carregar abas:", e);
      setAbas([]);
      await carregarDadosPlanilha(abaPreferida);
    }
  }, [carregarDadosPlanilha]);

  const carregarDadosBanco = useCallback(async (periodoPreferido?: string) => {
    setLoadingBanco(true);
    setErro(null);

    try {
      const { data, error } = await supabase
        .from("solicitacoes_os")
        .select("id, executante, cliente_id, data_os, hora_inicio, hora_fim, ticket, tarefa, horas_executadas, status_os, clientes(nome)")
        .gt("horas_executadas", 0)
        .order("data_os", { ascending: false })
        .order("hora_inicio", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const lista: ApontamentoStatusReport[] = (data ?? []).map((item: any) => {
        const cliente = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;
        return {
          id: item.id,
          executante: item.executante ?? "",
          cliente_id: item.cliente_id ?? "",
          cliente_nome: cliente?.nome ?? "Sem cliente",
          data_os: item.data_os ?? "",
          hora_inicio: item.hora_inicio?.slice(0, 5) ?? "",
          hora_fim: item.hora_fim?.slice(0, 5) ?? "",
          ticket: item.ticket ?? null,
          tarefa: item.tarefa ?? "",
          horas_executadas: Number(item.horas_executadas ?? 0),
          status_os: item.status_os ?? "",
        };
      });

      const periodos = Array.from(
        new Set(lista.map((item) => periodoDaData(item.data_os)).filter(Boolean))
      ).sort(compararPeriodoDesc);

      const periodoAtivo =
        periodoPreferido && periodos.includes(periodoPreferido)
          ? periodoPreferido
          : periodos[0] ?? "";

      setApontamentosBanco(lista);
      setPeriodosBanco(periodos);
      setPeriodoBancoAtual(periodoAtivo);
      aplicarFiltroBanco(lista, periodoAtivo);
    } catch (e) {
      console.error("Erro ao carregar dados do banco:", e);
      setErro("Nao foi possivel carregar os dados do banco.");
      setApontamentosBanco([]);
      setPeriodosBanco([]);
      setPeriodoBancoAtual("");
      setDadosBanco([]);
    } finally {
      setLoadingBanco(false);
    }
  }, [aplicarFiltroBanco]);

  const carregarContratosComparacao = useCallback(async (periodo: string, apontamentos: ApontamentoStatusReport[]) => {
    const mesRef = periodoParaMesRef(periodo);
    if (!mesRef) return;

    setLoadingContratos(true);
    try {
      // Consumo agrupado por cliente_id para o período atual
      const consumidoMap = new Map<string, { nome: string; horas: number }>();
      apontamentos
        .filter((a) => periodoDaData(a.data_os) === periodo)
        .forEach((a) => {
          const atual = consumidoMap.get(a.cliente_id);
          consumidoMap.set(a.cliente_id, {
            nome: a.cliente_nome,
            horas: (atual?.horas ?? 0) + Number(a.horas_executadas || 0),
          });
        });

      const clienteIds = [...consumidoMap.keys()];
      const mesIsoDate = `${mesRef}-01`;

      // Busca histórico de contratos: vigente_de <= primeiro dia do mês
      // Como ordenado DESC, primeiro por cliente_id = contrato mais recente aplicável
      const { data: contratosData } = clienteIds.length > 0
        ? await supabase
            .from("contratos_horas")
            .select("cliente_id, horas_mensais, vigente_de")
            .in("cliente_id", clienteIds)
            .lte("vigente_de", mesIsoDate)
            .order("vigente_de", { ascending: false })
        : { data: [] };

      // Deduplica: para cada cliente, pega o contrato vigente mais recente
      const contratoVigenteMap = new Map<string, number>();
      (contratosData ?? []).forEach((row: any) => {
        if (!contratoVigenteMap.has(row.cliente_id)) {
          contratoVigenteMap.set(row.cliente_id, Number(row.horas_mensais));
        }
      });

      // Busca info de sustentação dos clientes do período
      const { data: clientesSust } = clienteIds.length > 0
        ? await supabase
            .from("clientes")
            .select("id, sustentacao_desde, status_sustentacao")
            .in("id", clienteIds)
        : { data: [] };

      const sustMap = new Map<string, { desde: string | null; status: string }>();
      (clientesSust ?? []).forEach((c: any) => {
        sustMap.set(c.id, {
          desde: c.sustentacao_desde ?? null,
          status: c.status_sustentacao ?? "ativo",
        });
      });

      // Monta resultado mesclando contrato vigente + consumo real + sustentação
      const contratados = new Set<string>();
      const resultado: ContratoVsConsumo[] = [];

      contratoVigenteMap.forEach((horasContratadas, clienteId) => {
        const consumoInfo = consumidoMap.get(clienteId);
        const consumidas = consumoInfo?.horas ?? 0;
        const nome = consumoInfo?.nome ?? "Cliente";
        const sust = sustMap.get(clienteId);
        contratados.add(clienteId);
        resultado.push({
          cliente_id: clienteId,
          cliente_nome: nome,
          horas_contratadas: horasContratadas,
          horas_consumidas: consumidas,
          saldo: horasContratadas - consumidas,
          pct: horasContratadas > 0 ? Math.round((consumidas / horasContratadas) * 100) : 0,
          sustentacao_desde: sust?.desde ?? null,
          status_sustentacao: sust?.status ?? "ativo",
        });
      });

      // Clientes com consumo mas sem contrato cadastrado para este mês
      consumidoMap.forEach(({ nome, horas }, id) => {
        if (!contratados.has(id)) {
          const sust = sustMap.get(id);
          resultado.push({
            cliente_id: id,
            cliente_nome: nome,
            horas_contratadas: 0,
            horas_consumidas: horas,
            saldo: -horas,
            pct: 0,
            sustentacao_desde: sust?.desde ?? null,
            status_sustentacao: sust?.status ?? "ativo",
          });
        }
      });

      resultado.sort((a, b) => b.horas_consumidas - a.horas_consumidas);
      setContratosComparacao(resultado);
    } catch (e) {
      console.error("Erro ao carregar contratos:", e);
    } finally {
      setLoadingContratos(false);
    }
  }, []);

  useEffect(() => {
    void carregarAbas();
  }, [carregarAbas]);

  useEffect(() => {
    if (fonteDados === "supabase" && apontamentosBanco.length === 0) {
      void carregarDadosBanco();
    }
  }, [fonteDados, apontamentosBanco.length, carregarDadosBanco]);

  useEffect(() => {
    if (fonteDados === "supabase" && periodoBancoAtual) {
      void carregarContratosComparacao(periodoBancoAtual, apontamentosBanco);
    }
  }, [fonteDados, periodoBancoAtual, apontamentosBanco, carregarContratosComparacao]);

  const dadosGlobais = fonteDados === "backend" ? dadosPlanilha : dadosBanco;
  const loading = fonteDados === "backend" ? loadingPlanilha : loadingBanco;
  const periodoAtual = fonteDados === "backend" ? abaAtual : periodoBancoAtual;
  const periodoAtualLabel = periodoAtual ? formatarAba(periodoAtual) : "Sem periodo";

  useEffect(() => {
    setEmpresaAtiva(null);
    setBuscaAtividade("");
    montar(dadosGlobais);
  }, [fonteDados, dadosGlobais, montar]);

  useEffect(() => {
    if (!exportDropdown) return;
    const handler = () => setExportDropdown(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [exportDropdown]);

  // ── Computed: empresa selecionada ──────────────────────────────────────────
  const atividadesFiltradas = empresaAtiva
    ? empresaAtiva.linhas.filter((linha) => {
        if (!buscaAtividade) return true;
        const termo = buscaAtividade.toLowerCase();
        return (
          (linha["Tarefa"] || linha["tarefa"] || "").toLowerCase().includes(termo) ||
          (linha["executante"] || "").toLowerCase().includes(termo)
        );
      })
    : [];

  const contratoAtivo = fonteDados === "supabase" && empresaAtiva
    ? (contratosComparacao.find((c) => c.cliente_nome === empresaAtiva.empresa) ?? null)
    : null;

  const contratosComCobertura = contratosComparacao.filter((c) => c.horas_contratadas > 0);
  const carteiraHorasContratadas = contratosComCobertura.reduce((acc, item) => acc + item.horas_contratadas, 0);
  const carteiraHorasConsumidas = contratosComparacao.reduce((acc, item) => acc + item.horas_consumidas, 0);
  const carteiraSaldoHoras = carteiraHorasContratadas - carteiraHorasConsumidas;
  const pctCarteira = carteiraHorasContratadas > 0
    ? Math.round((carteiraHorasConsumidas / carteiraHorasContratadas) * 100)
    : 0;

  const horasContratoNum = contratoAtivo?.horas_contratadas ?? 0;
  const horasConsumidasNum = contratoAtivo
    ? contratoAtivo.horas_consumidas
    : empresaAtiva ? +(empresaAtiva.totalMinutos / 60).toFixed(2) : 0;
  const horasRestantesNum = horasContratoNum > 0 ? horasContratoNum - horasConsumidasNum : 0;
  const horasContratoDisplay = horasContratoNum > 0 ? decimalParaHHMM(horasContratoNum) : "—";
  const horasConsumidasDisplay = decimalParaHHMM(horasConsumidasNum);
  const horasRestantesDisplay = horasContratoNum > 0
    ? `${horasRestantesNum >= 0 ? "+" : "-"}${decimalParaHHMM(Math.abs(horasRestantesNum))}`
    : "—";
  const carteiraHorasContratadasDisplay = carteiraHorasContratadas > 0 ? decimalParaHHMM(carteiraHorasContratadas) : "—";
  const carteiraHorasConsumidasDisplay = decimalParaHHMM(carteiraHorasConsumidas);
  const carteiraSaldoDisplay = carteiraHorasContratadas > 0
    ? `${carteiraSaldoHoras >= 0 ? "+" : "-"}${decimalParaHHMM(Math.abs(carteiraSaldoHoras))}`
    : "—";
  const pctConsumo = horasContratoNum > 0
    ? Math.min(Math.round((horasConsumidasNum / horasContratoNum) * 100), 999)
    : 0;
  const pctConsumoVisual = limitarPct(pctConsumo);
  const pctCarteiraVisual = limitarPct(pctCarteira);

  const statusContrato = obterStatusContratoVisual(horasContratoNum, pctConsumo);
  const statusCarteira = obterStatusContratoVisual(carteiraHorasContratadas, pctCarteira);

  const distribuicaoContratos = {
    saudaveis: contratosComparacao.filter((c) => c.horas_contratadas > 0 && c.pct < 80).length,
    atencao: contratosComparacao.filter((c) => c.horas_contratadas > 0 && c.pct >= 80 && c.pct < 100).length,
    criticos: contratosComparacao.filter((c) => c.horas_contratadas > 0 && c.pct >= 100).length,
    semContrato: contratosComparacao.filter((c) => c.horas_contratadas === 0).length,
  };

  const horasPorConsultor = empresaAtiva
    ? Object.entries(
        empresaAtiva.linhas.reduce((acc, l) => {
          const c = ((l["executante"] || "").trim()) || "—";
          acc[c] = (acc[c] || 0) + parsearHoras(l["Executado"] || "0:00");
          return acc;
        }, {} as Record<string, number>)
      )
      .map(([name, min]) => ({ name, horas: +(min / 60).toFixed(2) }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8)
    : [];

  const consultorLider = horasPorConsultor[0] ?? null;
  const diasAtivosEmpresa = empresaAtiva
    ? new Set(empresaAtiva.linhas.map((linha) => linha["Data"] || linha["data_os"]).filter(Boolean)).size
    : 0;
  const mediaDiaEmpresa = empresaAtiva
    ? minParaDisplay(Math.round(empresaAtiva.totalMinutos / Math.max(diasAtivosEmpresa, 1)))
    : "0h";
  const empresaDestaqueGeral = resumo[0] ?? null;
  const contratoDestaque = contratosComparacao[0] ?? null;
  const corPrincipalContrato = horasContratoNum === 0
    ? "hsl(120 13% 64%)"
    : pctConsumo >= 100
    ? "hsl(0 72% 51%)"
    : pctConsumo >= 80
    ? "hsl(38 92% 50%)"
    : "hsl(152 53% 40%)";

  const donutData = [
    { name: "Consumido", value: Math.max(0, Math.min(horasConsumidasNum, horasContratoNum || horasConsumidasNum)) },
    { name: "Disponível", value: Math.max(0, horasRestantesNum) },
  ];

  const kpisPlanilhaGerais: KpiCardData[] = [
    {
      label: "Total de horas",
      value: minParaDisplay(totalMinutosGeral),
      sub: `${dadosGlobais.length} atividade(s) consolidadas no período`,
      icon: Clock,
      color: "text-primary bg-primary/10",
      surface: "border-primary/15 bg-[linear-gradient(135deg,rgba(240,253,244,0.94),rgba(255,255,255,0.98))]",
    },
    {
      label: "Empresas",
      value: String(resumo.length),
      sub: resumo.length > 0 ? "carteira com apontamento no período" : "nenhuma empresa com consumo",
      icon: Building2,
      color: "text-blue-700 bg-blue-50",
      surface: "border-blue-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.98))]",
    },
    {
      label: "Atividades",
      value: String(dadosGlobais.length),
      sub: "total de tarefas agrupadas no relatório",
      icon: Activity,
      color: "text-violet-700 bg-violet-50",
      surface: "border-violet-200/60 bg-[linear-gradient(135deg,rgba(245,243,255,0.96),rgba(255,255,255,0.98))]",
    },
    {
      label: "Empresa destaque",
      value: empresaDestaqueGeral?.empresa ?? "—",
      sub: empresaDestaqueGeral
        ? `${minParaDisplay(empresaDestaqueGeral.totalMinutos)} consumidos no período`
        : "sem empresa com consumo no período",
      icon: TrendingUp,
      color: "text-emerald-700 bg-emerald-50",
      surface: "border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    },
  ];

  const kpisBancoGerais: KpiCardData[] = [
    {
      label: "Horas contratadas",
      value: carteiraHorasContratadasDisplay,
      sub: carteiraHorasContratadas > 0 ? "capacidade mensal cadastrada" : "nenhum contrato no período",
      icon: Clock,
      color: "text-blue-700 bg-blue-50",
      surface: "border-blue-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.98))]",
    },
    {
      label: "Horas consumidas",
      value: carteiraHorasConsumidasDisplay,
      sub: contratosComparacao.length > 0 ? `${pctCarteiraVisual}% da carteira contratada` : "sem apontamentos",
      icon: Activity,
      color: "text-primary bg-primary/10",
      surface: "border-primary/15 bg-[linear-gradient(135deg,rgba(240,253,244,0.94),rgba(255,255,255,0.98))]",
      progress: pctCarteiraVisual,
      progressClass: statusCarteira.progress,
    },
    {
      label: "Saldo restante",
      value: carteiraSaldoDisplay,
      sub: carteiraHorasContratadas > 0 ? (carteiraSaldoHoras >= 0 ? "ainda disponível na carteira" : "consumo acima da cobertura") : "sem base contratual",
      icon: TrendingUp,
      color: carteiraSaldoHoras < 0 ? "text-destructive bg-destructive/10" : "text-emerald-700 bg-emerald-50",
      surface: carteiraSaldoHoras < 0
        ? "border-destructive/15 bg-[linear-gradient(135deg,rgba(254,242,242,0.96),rgba(255,255,255,0.98))]"
        : "border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    },
    {
      label: "Maior consumo",
      value: contratoDestaque?.cliente_nome ?? "—",
      sub: contratoDestaque
        ? `${decimalParaHHMM(contratoDestaque.horas_consumidas)} consumidos neste recorte`
        : "sem consumo registrado no período",
      icon: Building2,
      color: "text-emerald-700 bg-emerald-50",
      surface: "border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    },
  ];

  const kpisEmpresaBanco: KpiCardData[] = [
    {
      label: "Contrato mensal",
      value: horasContratoDisplay,
      sub: horasContratoNum > 0 ? "meta contratada para o mês" : "contrato ainda não informado",
      icon: Clock,
      color: "text-blue-700 bg-blue-50",
      surface: "border-blue-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.98))]",
    },
    {
      label: "Horas consumidas",
      value: horasConsumidasDisplay,
      sub: horasContratoNum > 0 ? `${pctConsumoVisual}% utilizado no período` : "consumo total do período",
      icon: Activity,
      color: "text-primary bg-primary/10",
      surface: "border-primary/15 bg-[linear-gradient(135deg,rgba(240,253,244,0.94),rgba(255,255,255,0.98))]",
      progress: pctConsumoVisual,
      progressClass: statusContrato.progress,
    },
    {
      label: "Horas restantes",
      value: horasRestantesDisplay,
      sub: horasContratoNum > 0 ? (horasRestantesNum >= 0 ? "folga disponível até o fechamento" : "consumo acima do contratado") : "sem contrato mensal",
      icon: TrendingUp,
      color: horasRestantesNum < 0 ? "text-destructive bg-destructive/10" : "text-emerald-700 bg-emerald-50",
      surface: horasRestantesNum < 0
        ? "border-destructive/15 bg-[linear-gradient(135deg,rgba(254,242,242,0.96),rgba(255,255,255,0.98))]"
        : "border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    },
    {
      label: "Ritmo diário",
      value: mediaDiaEmpresa,
      sub: diasAtivosEmpresa > 0 ? `${diasAtivosEmpresa} dia(s) com apontamento` : "sem atividade no período",
      icon: BarChart3,
      color: "text-violet-700 bg-violet-50",
      surface: "border-violet-200/60 bg-[linear-gradient(135deg,rgba(245,243,255,0.96),rgba(255,255,255,0.98))]",
    },
  ];

  const kpisEmpresaPlanilha: KpiCardData[] = [
    {
      label: "Horas consumidas",
      value: empresaAtiva ? minParaDisplay(empresaAtiva.totalMinutos) : "0h",
      sub: empresaAtiva ? `${empresaAtiva.quantidade} atividade(s) no período` : "sem empresa selecionada",
      icon: Clock,
      color: "text-primary bg-primary/10",
      surface: "border-primary/15 bg-[linear-gradient(135deg,rgba(240,253,244,0.94),rgba(255,255,255,0.98))]",
    },
    {
      label: "Dias ativos",
      value: String(diasAtivosEmpresa),
      sub: diasAtivosEmpresa > 0 ? `${mediaDiaEmpresa} por dia com apontamento` : "sem atividade no período",
      icon: Activity,
      color: "text-blue-700 bg-blue-50",
      surface: "border-blue-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.98))]",
    },
    {
      label: "Top consultor",
      value: consultorLider ? consultorLider.name : "—",
      sub: consultorLider ? `${decimalParaHHMM(consultorLider.horas)} registradas` : "sem executantes no período",
      icon: User,
      color: "text-violet-700 bg-violet-50",
      surface: "border-violet-200/60 bg-[linear-gradient(135deg,rgba(245,243,255,0.96),rgba(255,255,255,0.98))]",
    },
    {
      label: "Média por atividade",
      value: empresaAtiva ? minParaDisplay(Math.round(empresaAtiva.totalMinutos / Math.max(empresaAtiva.quantidade, 1))) : "0h",
      sub: "tempo médio registrado por tarefa",
      icon: TrendingUp,
      color: "text-emerald-700 bg-emerald-50",
      surface: "border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))]",
    },
  ];

  const kpisGerais: KpiCardData[] = fonteDados === "supabase"
    ? (empresaAtiva ? kpisEmpresaBanco : kpisBancoGerais)
    : (empresaAtiva ? kpisEmpresaPlanilha : kpisPlanilhaGerais);

  const destaquesContrato = empresaAtiva ? [
    {
      label: "Cobertura do contrato",
      value: horasContratoNum > 0 ? `${pctConsumoVisual}% preenchido` : "Sem cobertura",
      sub: horasContratoNum > 0
        ? `${horasConsumidasDisplay} de ${horasContratoDisplay} já consumidos`
        : `${horasConsumidasDisplay} consumidos no período`,
    },
    {
      label: "Horas restantes",
      value: horasContratoNum > 0 ? horasRestantesDisplay : horasConsumidasDisplay,
      sub: horasContratoNum > 0
        ? (horasRestantesNum >= 0 ? "saldo disponível até o fechamento" : "consumo acima do contratado")
        : "consumo acumulado sem contrato cadastrado",
    },
    {
      label: "Ritmo diário",
      value: mediaDiaEmpresa,
      sub: diasAtivosEmpresa > 0 ? `${diasAtivosEmpresa} dia(s) com apontamento` : "sem apontamentos no período",
    },
    {
      label: "Consultor líder",
      value: consultorLider?.name ?? "—",
      sub: consultorLider ? `${decimalParaHHMM(consultorLider.horas)} no período` : "sem executantes registrados",
    },
  ] : [];

  const destaquesCarteira = [
    {
      label: "Cobertura total",
      value: carteiraHorasContratadasDisplay,
      sub: carteiraHorasContratadas > 0 ? "base contratual cadastrada para o mês" : "nenhuma cobertura cadastrada",
    },
    {
      label: "Saldo da carteira",
      value: carteiraSaldoDisplay,
      sub: carteiraHorasContratadas > 0
        ? (carteiraSaldoHoras >= 0 ? "folga consolidada do período" : "carteira acima da cobertura")
        : "sem base contratual para comparar",
    },
    {
      label: "Clientes críticos",
      value: String(distribuicaoContratos.criticos),
      sub: distribuicaoContratos.criticos > 0 ? "consumo acima do contratado" : "nenhum cliente estourado",
    },
    {
      label: "Sem contrato",
      value: String(distribuicaoContratos.semContrato),
      sub: distribuicaoContratos.semContrato > 0 ? "clientes ainda sem cobertura" : "todos com cobertura definida",
    },
  ];

  const handleAtualizar = () => {
    setExportDropdown(false);

    if (fonteDados === "backend") {
      if (abas.length > 0) {
        void carregarDadosPlanilha(abaAtual || abas[0]);
      } else {
        void carregarAbas(abaAtual);
      }
      return;
    }

    void carregarDadosBanco(periodoBancoAtual);
  };

  const subtitulo = fonteDados === "backend"
    ? `Planilha / Google Sheets . ${periodoAtualLabel}`
    : `Banco de dados . ${periodoAtualLabel}`;

  const headerExtra = (
    <div className="relative flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleAtualizar}
        className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-background text-foreground hover:bg-muted/40"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Atualizar
      </button>

      <div className="relative">
        <button
          disabled={dadosGlobais.length === 0}
          onClick={() => setExportDropdown((value) => !value)}
          className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-background text-foreground hover:bg-muted/40 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar
        </button>
        {exportDropdown && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-card border border-border rounded-xl shadow-lg z-20 overflow-hidden">
            <button
              onClick={() => {
                exportarExcelGeral(dadosGlobais, periodoAtual);
                setExportDropdown(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-left hover:bg-muted/40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-700" />
              Excel . todos os dados
            </button>
            <button
              onClick={() => abrirModal("excel")}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-left hover:bg-muted/40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-700" />
              Excel . por empresa
            </button>
            <div className="border-t border-border/50 mx-3" />
            <button
              onClick={() => abrirModal("pdf")}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-left hover:bg-muted/40"
            >
              <FileText className="h-3.5 w-3.5 text-red-500" />
              PDF . por empresa
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Seleciona empresa via dropdown ────────────────────────────────────────
  function selecionarEmpresa(nome: string) {
    if (!nome) { setEmpresaAtiva(null); setBuscaAtividade(""); return; }
    const r = resumo.find((x) => x.empresa === nome);
    if (r) { setEmpresaAtiva(r); setBuscaAtividade(""); }
  }

  return (
    <>
      {modal.aberto && (
        <ModalExport
          resumo={resumo}
          modo={modal.modo}
          periodoAtual={periodoAtual}
          dadosGlobais={dadosGlobais}
          onClose={() => setModal((value) => ({ ...value, aberto: false }))}
        />
      )}

      <AppLayout title="Status Report" subtitle={subtitulo} headerExtra={headerExtra}>
        {/* ── Barra de controle ──────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-3 shadow-[var(--shadow-sm)] flex flex-wrap items-center gap-2">
          {/* Source toggle */}
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5 shrink-0">
            {([
              { id: "backend" as FonteDados, icon: Server, label: "Planilha" },
              { id: "supabase" as FonteDados, icon: Database, label: "Banco de Dados" },
            ] as const).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setFonteDados(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  fonteDados === id
                    ? "bg-card text-primary shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-border shrink-0" />

          {/* Period selector */}
          {fonteDados === "backend" ? (
            <select
              value={abaAtual}
              onChange={(e) => void carregarDadosPlanilha(e.target.value)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8"
            >
              {abas.length === 0
                ? <option value="">Carregando...</option>
                : abas.map((a) => <option key={a} value={a}>{formatarAba(a)}</option>)
              }
            </select>
          ) : (
            <select
              value={periodoBancoAtual}
              onChange={(e) => {
                setPeriodoBancoAtual(e.target.value);
                aplicarFiltroBanco(apontamentosBanco, e.target.value);
              }}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8"
            >
              {periodosBanco.length === 0
                ? <option value="">Sem dados</option>
                : periodosBanco.map((p) => <option key={p} value={p}>{formatarAba(p)}</option>)
              }
            </select>
          )}

          {/* Company selector */}
          <select
            value={empresaAtiva?.empresa ?? ""}
            onChange={(e) => selecionarEmpresa(e.target.value)}
            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8 max-w-[220px]"
          >
            <option value="">Todas as empresas</option>
            {resumo.map((r) => (
              <option key={r.empresa} value={r.empresa}>{r.empresa}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            {(loading || loadingContratos) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <span className="text-[11px] text-muted-foreground font-mono">
              {loading ? "Carregando..." : `${dadosGlobais.length} atividades`}
            </span>
          </div>
        </div>

        {/* ── Erro ── */}
        {erro && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-xs text-destructive">
            {erro}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        {fonteDados === "supabase" && (
          <div className={`grid gap-4 ${empresaAtiva ? "xl:grid-cols-[1.2fr_0.8fr]" : "xl:grid-cols-[1.15fr_0.85fr]"}`}>
            <div className={`rounded-2xl border p-5 shadow-[var(--shadow-sm)] ${empresaAtiva ? statusContrato.panel : statusCarteira.panel}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold ${empresaAtiva ? statusContrato.chip : statusCarteira.chip}`}>
                    <span className={`h-2 w-2 rounded-full ${empresaAtiva ? statusContrato.dot : statusCarteira.dot}`} />
                    {empresaAtiva ? `Contrato ${statusContrato.label}` : `Carteira ${statusCarteira.label}`}
                  </span>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-foreground">
                      {empresaAtiva ? empresaAtiva.empresa : "Visão de saúde da carteira"}
                    </h2>
                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {empresaAtiva ? statusContrato.headline : statusCarteira.headline}
                    </p>
                  </div>
                </div>

                <div className="min-w-[220px] rounded-2xl border border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
                    {empresaAtiva ? "Utilização atual" : "Preenchimento da carteira"}
                  </div>
                  <div className={`mt-1 text-3xl font-bold font-mono ${empresaAtiva ? statusContrato.color : statusCarteira.color}`}>
                    {empresaAtiva ? `${pctConsumoVisual}%` : `${pctCarteiraVisual}%`}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {empresaAtiva
                      ? `${horasConsumidasDisplay} consumidos de ${horasContratoDisplay}`
                      : `${carteiraHorasConsumidasDisplay} consumidos de ${carteiraHorasContratadasDisplay}`}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                  <span>{empresaAtiva ? "Preenchimento do contrato de sustentação" : "Cobertura geral dos contratos"}</span>
                  <span>
                    {empresaAtiva
                      ? (horasContratoNum > 0
                        ? `${Math.abs(horasRestantesNum) > 0 ? decimalParaHHMM(Math.abs(horasRestantesNum)) : "0h"} ${horasRestantesNum >= 0 ? "restantes" : "acima do contratado"}`
                        : "sem contrato mensal cadastrado")
                      : (carteiraHorasContratadas > 0
                        ? `${Math.abs(carteiraSaldoHoras) > 0 ? decimalParaHHMM(Math.abs(carteiraSaldoHoras)) : "0h"} ${carteiraSaldoHoras >= 0 ? "restantes" : "acima da cobertura"}`
                        : "sem cobertura contratual")}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full ${empresaAtiva ? statusContrato.progress : statusCarteira.progress}`}
                    style={{ width: `${empresaAtiva ? pctConsumoVisual : pctCarteiraVisual}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(empresaAtiva ? destaquesContrato : destaquesCarteira).map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
                      {item.label}
                    </div>
                    <div className="mt-2 text-lg font-bold text-foreground">{item.value}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.sub}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {kpisGerais.map(({ label, value, sub, icon: Icon, color, surface, progress, progressClass }) => (
                <div key={label} className={`rounded-2xl border p-4 shadow-[var(--shadow-sm)] ${surface ?? "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono leading-tight">
                        {label}
                      </span>
                      <div className={`mt-2 text-2xl font-bold ${loading ? "animate-pulse text-muted" : "text-foreground"}`}>
                        {loading ? "—" : value}
                      </div>
                    </div>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  {sub && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sub}</p>}
                  {typeof progress === "number" && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/80">
                        <div
                          className={`h-full rounded-full ${progressClass ?? "bg-primary"}`}
                          style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {fonteDados !== "supabase" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpisGerais.map(({ label, value, sub, icon: Icon, color, surface }) => (
              <div key={label} className={`rounded-2xl border p-4 shadow-[var(--shadow-sm)] ${surface ?? "border-border bg-card"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono leading-tight">
                      {label}
                    </span>
                    <div className={`mt-2 text-2xl font-bold ${loading ? "animate-pulse text-muted" : "text-foreground"}`}>
                      {loading ? "—" : value}
                    </div>
                  </div>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                {sub && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sub}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── Empresa selecionada: gráficos ─────────────────────────────── */}
        {empresaAtiva ? (
          <>
            {/* Donut + bar consultor */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
              {/* Donut de utilização */}
              <div className={`rounded-2xl border p-5 shadow-[var(--shadow-sm)] flex flex-col items-center justify-center gap-4 ${
                fonteDados === "supabase"
                  ? statusContrato.panel
                  : "border-primary/15 bg-[linear-gradient(135deg,rgba(240,253,244,0.94),rgba(255,255,255,0.98))]"
              }`}>
                <div className="flex w-full items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
                      {fonteDados === "supabase" && horasContratoNum > 0 ? "Utilização do contrato" : "Horas consumidas"}
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {empresaAtiva.empresa}
                    </p>
                  </div>
                  {fonteDados === "supabase" && (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusContrato.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusContrato.dot}`} />
                      {statusContrato.label}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <PieChart width={160} height={160}>
                    <Pie
                      data={
                        fonteDados === "supabase" && horasContratoNum > 0
                          ? donutData
                          : [{ name: "Consumido", value: horasConsumidasNum }, { name: "Resto", value: 0.001 }]
                      }
                      cx={75} cy={75}
                      innerRadius={52} outerRadius={70}
                      dataKey="value"
                      startAngle={90} endAngle={-270}
                      strokeWidth={0}
                    >
                      <Cell fill={corPrincipalContrato} />
                      <Cell fill="hsl(120,20%,92%)" />
                    </Pie>
                  </PieChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {fonteDados === "supabase" && horasContratoNum > 0 ? (
                      <>
                        <span className={`text-2xl font-bold font-mono ${statusContrato.color}`}>{pctConsumoVisual}%</span>
                        <span className="text-[10px] text-muted-foreground">utilizado</span>
                      </>
                    ) : (
                      <>
                        <span className="text-lg font-bold font-mono text-foreground">{decimalParaHHMM(horasConsumidasNum)}</span>
                        <span className="text-[10px] text-muted-foreground">consumido</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="w-full grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl border border-white/70 bg-white/75 py-2">
                    <div className="text-[11px] text-muted-foreground">Atividades</div>
                    <div className="text-sm font-bold font-mono text-foreground">{empresaAtiva.quantidade}</div>
                  </div>
                  <div className="rounded-xl border border-white/70 bg-white/75 py-2">
                    <div className="text-[11px] text-muted-foreground">Média/ativ.</div>
                    <div className="text-sm font-bold font-mono text-foreground">
                      {minParaDisplay(Math.round(empresaAtiva.totalMinutos / (empresaAtiva.quantidade || 1)))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bar horizontal por consultor */}
              <div className="rounded-2xl border border-blue-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.92),rgba(255,255,255,0.98))] p-5 shadow-[var(--shadow-sm)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
                      Horas por consultor
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {consultorLider
                        ? `${consultorLider.name} lidera com ${decimalParaHHMM(consultorLider.horas)}`
                        : "Distribuição do consumo entre os executantes"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-right shadow-sm">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Consultores</div>
                    <div className="text-lg font-bold text-foreground">{horasPorConsultor.length}</div>
                  </div>
                </div>
                {horasPorConsultor.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
                    Sem dados de executante.
                  </div>
                ) : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={horasPorConsultor}
                        layout="vertical"
                        margin={{ top: 0, right: 32, bottom: 0, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(120 20% 90%)" />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 10, fill: "hsl(120 13% 54%)" }}
                          tickFormatter={(v) => `${v}h`}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={90}
                          tick={{ fontSize: 11, fill: "hsl(120 13% 40%)" }}
                        />
                        <Tooltip
                          formatter={(v: number) => [`${v}h`, "Horas"]}
                          contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        />
                        <Bar dataKey="horas" radius={[0, 6, 6, 0]}>
                          {horasPorConsultor.map((_, i) => (
                            <Cell
                              key={i}
                              fill={GREEN_PAL[i % GREEN_PAL.length] + "dd"}
                              stroke={GREEN_PAL[i % GREEN_PAL.length]}
                              strokeWidth={1}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Lista de atividades */}
            <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <span className="text-[13px] font-semibold text-foreground">
                  Atividades — {empresaAtiva.empresa}
                </span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={buscaAtividade}
                    onChange={(e) => setBuscaAtividade(e.target.value)}
                    placeholder="Buscar atividade ou consultor..."
                    className="text-xs border border-border rounded-lg pl-7 pr-3 py-1.5 bg-background text-foreground w-[230px]"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[400px]">
                {atividadesFiltradas.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                    <Activity className="h-6 w-6 text-muted-foreground/30" />
                    Nenhuma atividade encontrada.
                  </div>
                ) : (
                  atividadesFiltradas.map((linha, index) => (
                    <div
                      key={`${linha["_id"] || index}`}
                      className="flex items-center justify-between px-5 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground truncate">
                          {linha["Tarefa"] || linha["tarefa"] || "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                          <User className="h-3 w-3 shrink-0" />
                          <span>{linha["executante"] || "—"}</span>
                          {linha["Data"] && <span className="opacity-60">· {linha["Data"]}</span>}
                        </div>
                      </div>
                      <div className="text-xs font-bold font-mono text-primary shrink-0 ml-4">
                        {linha["Executado"] || linha["executado"] || "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── Visão geral — sem empresa selecionada ── */
          <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-semibold text-foreground">
                  {fonteDados === "supabase" ? "Contrato vs Consumo" : "Resumo por Empresa"}
                </span>
                <span className="text-[11px] text-muted-foreground">— {periodoAtualLabel}</span>
              </div>
              {loadingContratos && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            {loading ? (
              <div className="p-10 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Carregando dados...
              </div>
            ) : fonteDados === "supabase" ? (
              // Banco: tabela contratos vs consumo
              contratosComparacao.length === 0 ? (
                <div className="p-10 text-center text-xs text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                  Nenhum contrato cadastrado para este período.
                  <br />
                  <span className="text-[11px]">Configure em <strong>Clientes → Status Report</strong>.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        {["Cliente / Empresa", "Contratado", "Consumido", "Saldo", "Utilização"].map((h) => (
                          <th
                            key={h}
                            className={`px-4 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide ${h === "Cliente / Empresa" ? "text-left" : "text-right"} ${h === "Utilização" ? "w-44 text-left" : ""}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contratosComparacao.map((c) => {
                        const over = c.pct > 100;
                        const warn = c.pct >= 80 && !over;
                        const sem = c.horas_contratadas === 0;
                        const barCls = sem ? "bg-muted" : over ? "bg-destructive" : warn ? "bg-amber-500" : "bg-primary";
                        const badgeCls = sem ? "text-muted-foreground bg-muted/60" : over ? "text-destructive bg-destructive/10" : warn ? "text-amber-700 bg-amber-50" : "text-green-700 bg-green-50";
                        return (
                          <tr
                            key={c.cliente_id}
                            className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                            onClick={() => selecionarEmpresa(c.cliente_nome)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <span className="font-medium text-foreground">{c.cliente_nome}</span>
                                <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
                                  {sem ? "Sem contrato" : over ? "Crítico" : warn ? "Atenção" : "Saudável"}
                                </span>
                                {c.sustentacao_desde && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    ativo desde {c.sustentacao_desde.slice(0, 7).split("-").reverse().join("/")}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                              {c.horas_contratadas > 0 ? decimalParaHHMM(c.horas_contratadas) : <span className="text-muted-foreground/50">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{decimalParaHHMM(c.horas_consumidas)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">
                              {sem ? <span className="text-muted-foreground/50">—</span> : (
                                <span className={c.saldo >= 0 ? "text-green-700" : "text-destructive"}>
                                  {c.saldo >= 0 ? "+" : "-"}{decimalParaHHMM(Math.abs(c.saldo))}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {sem ? (
                                <span className="text-[11px] text-muted-foreground/50">sem contrato</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(c.pct, 100)}%` }} />
                                  </div>
                                  <span className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded ${badgeCls}`}>{c.pct}%</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              // Planilha: resumo simples
              resumo.length === 0 ? (
                <div className="p-10 text-center text-xs text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                  Nenhum dado disponível para este período.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        {["Empresa", "Atividades", "Horas Consumidas"].map((h) => (
                          <th key={h} className={`px-4 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide ${h === "Empresa" ? "text-left" : "text-right"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.map((r) => (
                        <tr
                          key={r.empresa}
                          className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => selecionarEmpresa(r.empresa)}
                        >
                          <td className="px-4 py-3 font-medium text-foreground">{r.empresa}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground">{r.quantidade}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{minParaDisplay(r.totalMinutos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        )}
      </AppLayout>
    </>
  );
}
