import { useState, useEffect, useCallback, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Clock, Activity, Building2, TrendingUp, User,
  Loader2, RefreshCw, Search, X, ChevronDown,
  CalendarRange, FileBarChart2,
} from "lucide-react";
import { minParaDisplay, decimalParaDisplay } from "@/services/exportHelpers";

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Apontamento {
  id: string;
  executante: string;
  cliente_nome: string;
  data_os: string;
  hora_inicio: string;
  hora_fim: string;
  ticket: string | null;
  tarefa: string;
  horas_executadas: number;
  status_os: string;
}

interface KPIs {
  totalHoras: number;
  totalApontamentos: number;
  totalClientes: number;
  mediaPorOS: number;
}

interface PorDia     { data: string; horas: number; qtd: number; }
interface PorMes     { mes: string; horas: number; qtd: number; }
interface PorCliente { cliente: string; horas: number; qtd: number; }
interface PorConsultor { consultor: string; horas: number; qtd: number; }

// ── Paleta ────────────────────────────────────────────────────────────────────
const GREEN_PAL = [
  "#2e7d32","#43a047","#66bb6a","#81c784",
  "#1b5e20","#388e3c","#00c853","#69f0ae",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDataBr(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtMes(ym: string) {
  if (!ym || ym.length < 7) return ym;
  const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const [y, m] = ym.split("-");
  return `${meses[+m - 1]}/${y.slice(2)}`;
}

function hojeISO() { return new Date().toISOString().split("T")[0]; }
function primeiroDiaMes() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
}

// ── Tooltip custom ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="mt-0.5">
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ── Componente principal ───────────────────────────────────────────────────────
export default function Relatorios() {
  const { isAdmin, profile } = useAuth();
  const nomeLogado = profile?.nome ?? "";

  // ── Filtros ──
  const [dataInicio, setDataInicio] = useState(primeiroDiaMes());
  const [dataFim,    setDataFim]    = useState(hojeISO());
  const [consultor,  setConsultor]  = useState(isAdmin ? "" : nomeLogado);
  const [cliente,    setCliente]    = useState("");
  const [buscaTarefa, setBuscaTarefa] = useState("");

  // ── Dados ──
  const [apontamentos,    setApontamentos]    = useState<Apontamento[]>([]);
  const [consultores,     setConsultores]     = useState<string[]>([]);
  const [clientes,        setClientes]        = useState<string[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("");

  // ── Busca no banco ────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("solicitacoes_os")
        .select("id, executante, data_os, hora_inicio, hora_fim, ticket, tarefa, horas_executadas, status_os, clientes(nome)")
        .gte("data_os", dataInicio)
        .lte("data_os", dataFim)
        .gt("horas_executadas", 0)
        .order("data_os", { ascending: true })
        .order("hora_inicio", { ascending: true })
        .limit(5000);

      if (!isAdmin) q = q.eq("executante", nomeLogado);
      else if (consultor) q = q.eq("executante", consultor);

      const { data, error } = await q;
      if (error) throw error;

      const lista: Apontamento[] = (data ?? []).map((a: any) => ({
        id: a.id,
        executante: a.executante ?? "",
        cliente_nome: (Array.isArray(a.clientes) ? a.clientes[0] : a.clientes)?.nome ?? "Sem cliente",
        data_os: a.data_os ?? "",
        hora_inicio: a.hora_inicio?.slice(0, 5) ?? "",
        hora_fim: a.hora_fim?.slice(0, 5) ?? "",
        ticket: a.ticket ?? null,
        tarefa: a.tarefa ?? "",
        horas_executadas: Number(a.horas_executadas ?? 0),
        status_os: a.status_os ?? "",
      }));

      setApontamentos(lista);

      // Listas para os dropdowns
      setConsultores([...new Set(lista.map((a) => a.executante).filter(Boolean))].sort());
      setClientes([...new Set(lista.map((a) => a.cliente_nome).filter(Boolean))].sort());

      setUltimaAtualizacao(
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
    } catch (err) {
      console.error("Erro ao carregar relatórios:", err);
    } finally {
      setLoading(false);
    }
  }, [dataInicio, dataFim, isAdmin, nomeLogado, consultor]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Filtragem local (cliente + tarefa) ──
  const filtrados = useMemo(() => {
    return apontamentos.filter((a) => {
      if (cliente && a.cliente_nome !== cliente) return false;
      if (buscaTarefa && !a.tarefa.toLowerCase().includes(buscaTarefa.toLowerCase())) return false;
      return true;
    });
  }, [apontamentos, cliente, buscaTarefa]);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis: KPIs = useMemo(() => {
    const totalHoras = filtrados.reduce((s, a) => s + a.horas_executadas, 0);
    const clientesUnicos = new Set(filtrados.map((a) => a.cliente_nome)).size;
    return {
      totalHoras,
      totalApontamentos: filtrados.length,
      totalClientes: clientesUnicos,
      mediaPorOS: filtrados.length ? totalHoras / filtrados.length : 0,
    };
  }, [filtrados]);

  // ── Por dia ───────────────────────────────────────────────────────────────
  const porDia: PorDia[] = useMemo(() => {
    const map: Record<string, { horas: number; qtd: number }> = {};
    filtrados.forEach((a) => {
      if (!map[a.data_os]) map[a.data_os] = { horas: 0, qtd: 0 };
      map[a.data_os].horas += a.horas_executadas;
      map[a.data_os].qtd   += 1;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => ({
        data: fmtDataBr(data),
        horas: +v.horas.toFixed(2),
        qtd: v.qtd,
      }));
  }, [filtrados]);

  // ── Por mês ───────────────────────────────────────────────────────────────
  const porMes: PorMes[] = useMemo(() => {
    const map: Record<string, { horas: number; qtd: number }> = {};
    filtrados.forEach((a) => {
      const ym = a.data_os.slice(0, 7);
      if (!map[ym]) map[ym] = { horas: 0, qtd: 0 };
      map[ym].horas += a.horas_executadas;
      map[ym].qtd   += 1;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, v]) => ({
        mes: fmtMes(ym),
        horas: +v.horas.toFixed(2),
        qtd: v.qtd,
      }));
  }, [filtrados]);

  // ── Por cliente ───────────────────────────────────────────────────────────
  const porCliente: PorCliente[] = useMemo(() => {
    const map: Record<string, { horas: number; qtd: number }> = {};
    filtrados.forEach((a) => {
      const c = a.cliente_nome || "Sem cliente";
      if (!map[c]) map[c] = { horas: 0, qtd: 0 };
      map[c].horas += a.horas_executadas;
      map[c].qtd   += 1;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b.horas - a.horas)
      .slice(0, 10)
      .map(([cliente, v]) => ({
        cliente,
        horas: +v.horas.toFixed(2),
        qtd: v.qtd,
      }));
  }, [filtrados]);

  // ── Por consultor (admin) ─────────────────────────────────────────────────
  const porConsultor: PorConsultor[] = useMemo(() => {
    if (!isAdmin) return [];
    const map: Record<string, { horas: number; qtd: number }> = {};
    filtrados.forEach((a) => {
      const c = a.executante || "Sem nome";
      if (!map[c]) map[c] = { horas: 0, qtd: 0 };
      map[c].horas += a.horas_executadas;
      map[c].qtd   += 1;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b.horas - a.horas)
      .map(([consultor, v]) => ({
        consultor,
        horas: +v.horas.toFixed(2),
        qtd: v.qtd,
      }));
  }, [filtrados, isAdmin]);

  const limparFiltros = () => {
    setDataInicio(primeiroDiaMes());
    setDataFim(hojeISO());
    if (isAdmin) setConsultor("");
    setCliente("");
    setBuscaTarefa("");
  };

  const temFiltroAplicado =
    dataInicio !== primeiroDiaMes() || dataFim !== hojeISO() ||
    (isAdmin && consultor !== "") || cliente !== "" || buscaTarefa !== "";

  const subtitulo = isAdmin
    ? `Análise de apontamentos · ${filtrados.length} registro${filtrados.length !== 1 ? "s" : ""}`
    : `Seus apontamentos · ${nomeLogado}`;

  return (
    <AppLayout title="Relatórios" subtitle={subtitulo}>

      {/* ── Barra de filtros ────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange className="h-4 w-4 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">Filtros</span>
          {temFiltroAplicado && (
            <button
              onClick={limparFiltros}
              className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" /> Limpar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Data início */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
              Data início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8"
            />
          </div>

          {/* Data fim */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
              Data fim
            </label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8"
            />
          </div>

          {/* Consultor (admin) */}
          {isAdmin && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
                Consultor
              </label>
              <div className="relative">
                <select
                  value={consultor}
                  onChange={(e) => setConsultor(e.target.value)}
                  className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8 appearance-none pr-7"
                >
                  <option value="">Todos</option>
                  {consultores.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          )}

          {/* Cliente */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
              Cliente
            </label>
            <div className="relative">
              <select
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground h-8 appearance-none pr-7"
              >
                <option value="">Todos</option>
                {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Busca tarefa */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground font-mono">
              Buscar tarefa
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={buscaTarefa}
                onChange={(e) => setBuscaTarefa(e.target.value)}
                placeholder="Palavra-chave..."
                className="w-full text-xs border border-border rounded-lg pl-7 pr-3 py-1.5 bg-background text-foreground h-8"
              />
            </div>
          </div>
        </div>

        {/* Atalhos de período */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Atalhos:</span>
          {[
            { label: "Hoje", fn: () => { setDataInicio(hojeISO()); setDataFim(hojeISO()); } },
            { label: "Este mês", fn: () => { setDataInicio(primeiroDiaMes()); setDataFim(hojeISO()); } },
            { label: "Últ. 30d", fn: () => {
              const d = new Date(); d.setDate(d.getDate() - 30);
              setDataInicio(d.toISOString().split("T")[0]); setDataFim(hojeISO());
            }},
            { label: "Últ. 3 meses", fn: () => {
              const d = new Date(); d.setMonth(d.getMonth() - 3);
              setDataInicio(d.toISOString().split("T")[0]); setDataFim(hojeISO());
            }},
            { label: "Este ano", fn: () => {
              const y = new Date().getFullYear();
              setDataInicio(`${y}-01-01`); setDataFim(hojeISO());
            }},
          ].map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all"
            >
              {label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!loading && ultimaAtualizacao && (
              <span className="text-[10px] text-muted-foreground font-mono">às {ultimaAtualizacao}</span>
            )}
            <button
              onClick={carregar}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-background text-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total de Horas",
            value: loading ? "—" : decimalParaDisplay(kpis.totalHoras),
            sub: `no período selecionado`,
            icon: Clock,
            gradient: "bg-gradient-green",
            glow: "hover:shadow-glow-green",
          },
          {
            label: "Ordens de Serviços",
            value: loading ? "—" : String(kpis.totalApontamentos),
            sub: "registros com horas",
            icon: Activity,
            gradient: "bg-gradient-blue",
            glow: "hover:shadow-glow-blue",
          },
          {
            label: "Clientes Atendidos",
            value: loading ? "—" : String(kpis.totalClientes),
            sub: "empresas no período",
            icon: Building2,
            gradient: "bg-gradient-amber",
            glow: "hover:shadow-glow-amber",
          },
          {
            label: "Média por OS",
            value: loading ? "—" : decimalParaDisplay(kpis.mediaPorOS),
            sub: "tempo médio por apontamento",
            icon: TrendingUp,
            gradient: "bg-gradient-violet",
            glow: "hover:shadow-glow-green",
          },
        ].map((k, i) => (
          <div
            key={k.label}
            className={`${k.gradient} ${k.glow} rounded-2xl p-5 text-white shadow-[var(--shadow-md)] animate-fade-in transition-all duration-300`}
            style={{ animationDelay: `${i * 0.07}s` }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest opacity-80 mb-1">{k.label}</p>
                <div className={`text-[34px] font-bold leading-none font-mono ${loading ? "animate-pulse opacity-50" : ""}`}>
                  {k.value}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <k.icon className="h-5 w-5 text-white" />
              </div>
            </div>
            <p className="text-[11px] opacity-75">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Sem dados ──────────────────────────────────────────────────────── */}
      {!loading && filtrados.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-12 text-center shadow-[var(--shadow-sm)]">
          <FileBarChart2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-semibold text-foreground">Nenhum apontamento encontrado</p>
          <p className="text-xs text-muted-foreground mt-1">Ajuste os filtros ou o período selecionado.</p>
        </div>
      )}

      {filtrados.length > 0 && (
        <>
          {/* ── Gráficos linha 1: Horas por dia + Por mês ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Horas por dia — área */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-semibold text-foreground">Horas por dia</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-4">Volume diário de horas apontadas</p>
              {loading ? (
                <div className="h-[220px] flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={porDia} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradHoras" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(123,46%,34%)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="hsl(123,46%,34%)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(120,20%,90%)" vertical={false} />
                    <XAxis dataKey="data" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
                            <p className="font-semibold mb-1">{label}</p>
                            <p className="text-primary">{decimalParaDisplay(payload[0]?.value as number)} — {payload[1]?.value} OS</p>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="horas" name="Horas" stroke="hsl(123,46%,34%)" strokeWidth={2} fill="url(#gradHoras)" />
                    <Area type="monotone" dataKey="qtd" name="OS" stroke="hsl(24,95%,49%)" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              <div className="flex items-center gap-4 mt-1">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="w-3 h-1 rounded bg-primary inline-block" /> Horas
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="w-3 h-px border-t-2 border-dashed inline-block" style={{ borderColor: "hsl(24,95%,49%)" }} /> Qtd OS
                </span>
              </div>
            </div>

            {/* Evolução mensal — barras */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-semibold text-foreground">Evolução mensal</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-4">Horas apontadas por mês</p>
              {loading ? (
                <div className="h-[220px] flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : porMes.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">Período menor que 1 mês.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={porMes} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(120,20%,90%)" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
                            <p className="font-semibold mb-1">{label}</p>
                            <p className="text-primary">{decimalParaDisplay(payload[0]?.value as number)} · {payload[0]?.payload?.qtd} OS</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="horas" radius={[6, 6, 0, 0]}>
                      {porMes.map((_, i) => (
                        <Cell key={i} fill={GREEN_PAL[i % GREEN_PAL.length] + "dd"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Gráficos linha 2: Por cliente + Por consultor ────────────── */}
          <div className={`grid grid-cols-1 ${isAdmin ? "lg:grid-cols-2" : ""} gap-4`}>

            {/* Horas por cliente */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-semibold text-foreground">Horas por cliente</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-4">Top 10 clientes por horas apontadas</p>
              {loading ? (
                <div className="h-[260px] flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, porCliente.length * 36)}>
                  <BarChart data={porCliente} layout="vertical" margin={{ top: 0, right: 50, bottom: 0, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(120,20%,90%)" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}h`} />
                    <YAxis type="category" dataKey="cliente" width={110} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v: number) => [decimalParaDisplay(v), "Horas"]}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                    />
                    <Bar dataKey="horas" radius={[0, 6, 6, 0]}>
                      {porCliente.map((_, i) => (
                        <Cell key={i} fill={GREEN_PAL[i % GREEN_PAL.length] + "dd"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Ranking por consultor (admin) */}
            {isAdmin && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
                <div className="flex items-center gap-2 mb-1">
                  <User className="h-4 w-4 text-primary" />
                  <span className="text-[13px] font-semibold text-foreground">Ranking de consultores</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-4">Horas apontadas por consultor no período</p>
                {loading ? (
                  <div className="h-[260px] flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {porConsultor.map((c, i) => {
                      const max = porConsultor[0]?.horas || 1;
                      const pct = Math.round((c.horas / max) * 100);
                      const rankColor = i === 0 ? "text-[hsl(var(--amber))]" : i === 1 ? "text-muted-foreground" : "text-muted-foreground/60";
                      return (
                        <div key={c.consultor}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[11px] font-mono font-bold w-5 ${rankColor}`}>#{i + 1}</span>
                              <span className="text-[12px] font-medium text-foreground">{c.consultor}</span>
                              <span className="text-[10px] text-muted-foreground">{c.qtd} OS</span>
                            </div>
                            <span className="text-[12px] font-bold font-mono text-primary">{decimalParaDisplay(c.horas)}</span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%`, background: GREEN_PAL[i % GREEN_PAL.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Tabela detalhada ───────────────────────────────────────────── */}
          <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <FileBarChart2 className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-semibold text-foreground">Detalhamento</span>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {filtrados.length}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-secondary/80 backdrop-blur-sm">
                    <th className="p-3 text-left font-semibold text-muted-foreground">Data</th>
                    {isAdmin && <th className="p-3 text-left font-semibold text-muted-foreground">Consultor</th>}
                    <th className="p-3 text-left font-semibold text-muted-foreground">Cliente</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Horário</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Ticket</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Tarefa</th>
                    <th className="p-3 text-right font-semibold text-muted-foreground">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((a) => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">
                        {fmtDataBr(a.data_os)}/{a.data_os.slice(0, 4).slice(2)}
                      </td>
                      {isAdmin && <td className="p-3 whitespace-nowrap font-medium text-foreground">{a.executante}</td>}
                      <td className="p-3 whitespace-nowrap text-foreground font-medium">{a.cliente_nome}</td>
                      <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">{a.hora_inicio}–{a.hora_fim}</td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{a.ticket ?? "–"}</td>
                      <td className="p-3 max-w-[260px] truncate text-muted-foreground" title={a.tarefa}>{a.tarefa}</td>
                      <td className="p-3 text-right font-mono font-bold text-primary whitespace-nowrap">
                        {decimalParaDisplay(a.horas_executadas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr className="border-t border-border bg-secondary/80 backdrop-blur-sm">
                    <td colSpan={isAdmin ? 6 : 5} className="p-3 text-[11px] font-semibold text-muted-foreground">
                      Total ({filtrados.length} apontamento{filtrados.length !== 1 ? "s" : ""})
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-primary">
                      {decimalParaDisplay(kpis.totalHoras)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  );
}
