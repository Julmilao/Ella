import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Clock, ClipboardList, CheckCircle2, TrendingUp, ArrowRight,
  Loader2, RefreshCw, Bot, Zap, XCircle, Activity, Target,
  BarChart3, User, Calendar,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid,
} from "recharts";
import { decimalParaDisplay } from "@/services/exportHelpers";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface KPIData {
  totalPendentes: number;
  prontasApontar: number;
  aguardandoRPA: number;
  errosRPA: number;
  apontadas: number;
  pendentesHoje: number;
}

interface OSRow {
  id: string;
  executante: string;
  cliente_nome: string;
  data_os: string;
  hora_inicio: string;
  hora_fim: string;
  ticket: string | null;
  tarefa: string;
  status_os: string;
  status_abertura: string;
  horas_executadas: number;
}

interface PorExecutante { executante: string; quantidade: number; }
interface HoraCliente   { cliente: string; horas: number; }
interface TimelineItem  { data: string; apontadas: number; pendentes: number; }
interface ResumoPorConsultor {
  executante: string;
  pendentesHoje: number;
  totalPendentes: number;
  prontasApontar: number;
  aguardandoRPA: number;
  errosRPA: number;
  apontadas: number;
  horasApontadas: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtData = (d: string) => {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
};

const GREEN_PAL = [
  "#2e7d32", "#43a047", "#66bb6a", "#81c784",
  "#1b5e20", "#388e3c", "#00c853", "#69f0ae",
];

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

const StatusOSBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
    value === "OS Apontada" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
  }`}>{value}</span>
);

const StatusAberturaBadge = ({ value }: { value: string }) => {
  const cls =
    value === "OS Aberta" ? "bg-blue-100 text-blue-700" :
    value === "Erro"      ? "bg-red-100 text-red-700"   :
                            "bg-slate-100 text-slate-500";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{value}</span>;
};

// ── Componente principal ───────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin, profile } = useAuth();
  const nomeLogado = profile?.nome ?? "";

  const [kpis, setKpis] = useState<KPIData>({
    totalPendentes: 0, prontasApontar: 0, aguardandoRPA: 0,
    errosRPA: 0, apontadas: 0, pendentesHoje: 0,
  });
  const [pendentesHoje, setPendentesHoje]         = useState<OSRow[]>([]);
  const [prontasApontar, setProntasApontar]       = useState<OSRow[]>([]);
  const [errosLista, setErrosLista]               = useState<OSRow[]>([]);
  const [porExecutante, setPorExecutante]         = useState<PorExecutante[]>([]);
  const [horasPorCliente, setHorasPorCliente]     = useState<HoraCliente[]>([]);
  const [dadosTimeline, setDadosTimeline]         = useState<TimelineItem[]>([]);
  const [resumoConsultores, setResumoConsultores] = useState<ResumoPorConsultor[]>([]);
  const [horasTotais, setHorasTotais]             = useState(0);
  const [taxaConclusao, setTaxaConclusao]         = useState(0);
  const [loading, setLoading]                     = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const hoje = new Date().toISOString().split("T")[0];

      const { data: todos, error } = await supabase
        .from("solicitacoes_os")
        .select(
          "id, executante, cliente_id, data_os, hora_inicio, hora_fim, ticket, tarefa, status_os, status_abertura, horas_executadas, clientes(nome)"
        )
        .order("data_os", { ascending: false })
        .limit(2000);

      if (error) throw error;

      const lista: OSRow[] = (todos ?? []).map((a: any) => ({
        ...a,
        cliente_nome:    a.clientes?.nome ?? "–",
        hora_inicio:     a.hora_inicio?.slice(0, 5) ?? "",
        hora_fim:        a.hora_fim?.slice(0, 5) ?? "",
        status_abertura: a.status_abertura ?? "OS Não Aberta",
        horas_executadas: Number(a.horas_executadas ?? 0),
      }));

      const minhaLista = isAdmin ? lista : lista.filter((a) => a.executante === nomeLogado);

      // ── KPIs ──
      const pendentes  = minhaLista.filter((a) => a.status_os === "Pendente Apontamento");
      const apontadas  = minhaLista.filter((a) => a.status_os === "OS Apontada");
      const prontas    = pendentes.filter((a) => a.status_abertura === "OS Aberta");
      const aguardando = pendentes.filter((a) => a.status_abertura === "OS Não Aberta");
      const erros      = minhaLista.filter((a) => a.status_abertura === "Erro");
      const pHoje      = pendentes.filter((a) => a.data_os === hoje);

      setKpis({
        totalPendentes: pendentes.length,
        prontasApontar: prontas.length,
        aguardandoRPA:  aguardando.length,
        errosRPA:       erros.length,
        apontadas:      apontadas.length,
        pendentesHoje:  pHoje.length,
      });

      setPendentesHoje(pHoje.slice(0, 10));
      setProntasApontar(prontas.slice(0, 15));
      setErrosLista(erros.slice(0, 10));

      // ── Horas totais apontadas ──
      const hTotal = apontadas.reduce((s, a) => s + a.horas_executadas, 0);
      setHorasTotais(+hTotal.toFixed(1));

      // ── Taxa de conclusão ──
      const total = pendentes.length + apontadas.length;
      setTaxaConclusao(total > 0 ? Math.round((apontadas.length / total) * 100) : 0);

      // ── Horas por cliente (para consultor) ──
      const clienteMap: Record<string, number> = {};
      apontadas.forEach((a) => {
        const c = a.cliente_nome || "Sem cliente";
        clienteMap[c] = (clienteMap[c] ?? 0) + a.horas_executadas;
      });
      setHorasPorCliente(
        Object.entries(clienteMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
          .map(([cliente, horas]) => ({ cliente, horas: +horas.toFixed(1) }))
      );

      // ── Timeline últimos 30 dias ──
      const diasBase: Record<string, TimelineItem> = {};
      const hoje30 = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(hoje30);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        diasBase[key] = { data: fmtData(key), apontadas: 0, pendentes: 0 };
      }
      apontadas.forEach((a) => {
        if (diasBase[a.data_os]) diasBase[a.data_os].apontadas += 1;
      });
      pendentes.forEach((a) => {
        if (diasBase[a.data_os]) diasBase[a.data_os].pendentes += 1;
      });
      setDadosTimeline(Object.values(diasBase));

      // ── Pendentes por executante (admin) ──
      const execMap: Record<string, number> = {};
      pendentes.forEach((a) => {
        const n = a.executante || "Sem nome";
        execMap[n] = (execMap[n] ?? 0) + 1;
      });
      setPorExecutante(
        Object.entries(execMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
          .map(([executante, quantidade]) => ({ executante, quantidade }))
      );

      // ── Resumo por consultor (admin) ──
      if (isAdmin) {
        const mapa: Record<string, ResumoPorConsultor> = {};
        lista.forEach((a) => {
          const nome = a.executante || "Sem nome";
          if (!mapa[nome]) {
            mapa[nome] = {
              executante: nome, pendentesHoje: 0, totalPendentes: 0,
              prontasApontar: 0, aguardandoRPA: 0, errosRPA: 0,
              apontadas: 0, horasApontadas: 0,
            };
          }
          if (a.status_os === "Pendente Apontamento") {
            mapa[nome].totalPendentes += 1;
            if (a.data_os === hoje)                    mapa[nome].pendentesHoje  += 1;
            if (a.status_abertura === "OS Aberta")     mapa[nome].prontasApontar += 1;
            if (a.status_abertura === "OS Não Aberta") mapa[nome].aguardandoRPA  += 1;
          }
          if (a.status_abertura === "Erro")  mapa[nome].errosRPA      += 1;
          if (a.status_os === "OS Apontada") {
            mapa[nome].apontadas      += 1;
            mapa[nome].horasApontadas += a.horas_executadas;
          }
        });
        setResumoConsultores(
          Object.values(mapa)
            .sort((a, b) => b.horasApontadas - a.horasApontadas)
        );
      }

      setUltimaAtualizacao(
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
    } catch (err) {
      console.error("Erro ao carregar dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, nomeLogado]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Configs de cards ──────────────────────────────────────────────────────
  const cardsAdmin = [
    {
      label: "Total Pendentes",
      value: kpis.totalPendentes,
      sub: `${kpis.pendentesHoje} com data de hoje`,
      icon: ClipboardList,
      gradient: "bg-gradient-amber",
      glow: "hover:shadow-glow-amber",
      onClick: () => navigate("/lancamento-os"),
    },
    {
      label: "Prontas para Apontar",
      value: kpis.prontasApontar,
      sub: "OS abertas pelo RPA aguardando apontamento",
      icon: Zap,
      gradient: "bg-gradient-green",
      glow: "hover:shadow-glow-green",
      onClick: () => navigate("/lancamento-os"),
    },
    {
      label: "Aguardando RPA",
      value: kpis.aguardandoRPA,
      sub: "Pendentes não abertas pelo robô ainda",
      icon: Bot,
      gradient: "bg-gradient-blue",
      glow: "hover:shadow-glow-blue",
      onClick: () => navigate("/abertura-automatica"),
    },
    {
      label: "Erros RPA",
      value: kpis.errosRPA,
      sub: "OS onde o robô falhou na abertura",
      icon: XCircle,
      gradient: "bg-gradient-red",
      glow: "hover:shadow-glow-red",
      onClick: () => navigate("/abertura-automatica"),
    },
  ];

  const cardsConsultor = [
    {
      label: "Horas Apontadas",
      value: decimalParaDisplay(horasTotais),
      sub: `${kpis.apontadas} OS concluída${kpis.apontadas !== 1 ? "s" : ""}`,
      icon: Clock,
      gradient: "bg-gradient-green",
      glow: "hover:shadow-glow-green",
      onClick: () => navigate("/lancamento-os"),
    },
    {
      label: "Prontas para Apontar",
      value: kpis.prontasApontar,
      sub: "RPA abriu — aguardando seu apontamento",
      icon: Zap,
      gradient: "bg-gradient-amber",
      glow: "hover:shadow-glow-amber",
      onClick: () => navigate("/lancamento-os"),
    },
    {
      label: "Taxa de Conclusão",
      value: `${taxaConclusao}%`,
      sub: `${kpis.apontadas} de ${kpis.apontadas + kpis.totalPendentes} OS`,
      icon: Target,
      gradient: "bg-gradient-blue",
      glow: "hover:shadow-glow-blue",
      onClick: undefined,
    },
    {
      label: "Erros RPA",
      value: kpis.errosRPA,
      sub: kpis.errosRPA === 0 ? "Tudo funcionando" : "OS onde o robô falhou",
      icon: XCircle,
      gradient: kpis.errosRPA === 0 ? "bg-gradient-green" : "bg-gradient-red",
      glow: kpis.errosRPA === 0 ? "hover:shadow-glow-green" : "hover:shadow-glow-red",
      onClick: undefined,
    },
  ];

  const cards = isAdmin ? cardsAdmin : cardsConsultor;
  const totalAtivas = kpis.prontasApontar + kpis.aguardandoRPA + kpis.errosRPA;

  return (
    <AppLayout
      title="Dashboard"
      subtitle={isAdmin ? "Visão geral das ordens de serviço" : `Suas OS — ${nomeLogado}`}
    >

      {/* ── Header ── */}
      <div className="flex items-center justify-end -mb-1">
        <div className="flex items-center gap-2">
          {ultimaAtualizacao && (
            <span className="text-[11px] text-muted-foreground font-mono">
              Atualizado às {ultimaAtualizacao}
            </span>
          )}
          <button
            onClick={carregar}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-lg hover:bg-muted/60 border border-transparent hover:border-border"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar
          </button>
        </div>
      </div>

      {/* ── KPI Cards Gradiente ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              onClick={kpi.onClick}
              className={`${kpi.gradient} ${kpi.glow} rounded-2xl p-5 text-white shadow-[var(--shadow-md)] animate-fade-in transition-all duration-300 ${
                kpi.onClick ? "cursor-pointer hover:-translate-y-1" : ""
              }`}
              style={{ animationDelay: `${i * 0.07}s` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest opacity-80 mb-1">
                    {kpi.label}
                  </p>
                  <div className="text-[36px] font-bold leading-none font-mono">
                    {loading ? (
                      <div className="w-16 h-8 rounded bg-white/20 animate-pulse" />
                    ) : kpi.value}
                  </div>
                </div>
                <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-white" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] opacity-75 leading-relaxed">{kpi.sub}</p>
                {kpi.onClick && <ArrowRight className="h-3.5 w-3.5 opacity-60 shrink-0" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Barra de composição ── */}
      {!loading && totalAtivas > 0 && (
        <div
          className="bg-card border border-border rounded-xl px-5 py-4 shadow-[var(--shadow-sm)] animate-fade-in"
          style={{ animationDelay: "0.3s" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-semibold text-foreground">Composição das OS pendentes</span>
            <span className="text-[11px] text-muted-foreground font-mono">{totalAtivas} OS ativas</span>
          </div>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-0.5">
            {kpis.prontasApontar > 0 && (
              <div
                className="bg-primary transition-all rounded-l-full"
                style={{ width: `${(kpis.prontasApontar / totalAtivas) * 100}%` }}
                title={`Prontas: ${kpis.prontasApontar}`}
              />
            )}
            {kpis.aguardandoRPA > 0 && (
              <div
                className="transition-all"
                style={{ width: `${(kpis.aguardandoRPA / totalAtivas) * 100}%`, background: "hsl(var(--amber))" }}
                title={`Aguardando RPA: ${kpis.aguardandoRPA}`}
              />
            )}
            {kpis.errosRPA > 0 && (
              <div
                className="bg-destructive transition-all rounded-r-full"
                style={{ width: `${(kpis.errosRPA / totalAtivas) * 100}%` }}
                title={`Erros: ${kpis.errosRPA}`}
              />
            )}
          </div>
          <div className="flex items-center gap-5 mt-2.5">
            {[
              { label: "Prontas", val: kpis.prontasApontar, cls: "bg-primary" },
              { label: "Aguardando RPA", val: kpis.aguardandoRPA, cls: "bg-[hsl(var(--amber))]" },
              ...(kpis.errosRPA > 0 ? [{ label: "Erros RPA", val: kpis.errosRPA, cls: "bg-destructive" }] : []),
            ].map(({ label, val, cls }) => val > 0 && (
              <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${cls} inline-block`} />
                {label} ({Math.round((val / totalAtivas) * 100)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Gráficos principais ── */}
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in"
        style={{ animationDelay: "0.35s" }}
      >
        {/* Timeline — últimos 30 dias */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">Atividade — últimos 30 dias</span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-4">OS apontadas vs pendentes por dia</p>
          {loading ? (
            <div className="h-[220px] flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dadosTimeline} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradApontadas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(123,46%,34%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(123,46%,34%)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradPendentes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(24,95%,49%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(24,95%,49%)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(120,20%,90%)" vertical={false} />
                <XAxis
                  dataKey="data"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }} />
                <Area
                  type="monotone" dataKey="apontadas" name="Apontadas"
                  stroke="hsl(123,46%,34%)" strokeWidth={2}
                  fill="url(#gradApontadas)"
                />
                <Area
                  type="monotone" dataKey="pendentes" name="Pendentes"
                  stroke="hsl(24,95%,49%)" strokeWidth={2}
                  fill="url(#gradPendentes)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-3 h-1 rounded bg-primary inline-block" /> Apontadas
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-3 h-1 rounded inline-block" style={{ background: "hsl(24,95%,49%)" }} /> Pendentes
            </span>
          </div>
        </div>

        {/* Consultor: horas por cliente | Admin: donut por executante */}
        {!isAdmin ? (
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-semibold text-foreground">Horas apontadas por cliente</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-4">Top clientes por volume de horas</p>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : horasPorCliente.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg">
                Nenhuma hora apontada ainda.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={horasPorCliente}
                  layout="vertical"
                  margin={{ top: 0, right: 36, bottom: 0, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(120,20%,90%)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${v}h`}
                  />
                  <YAxis
                    type="category" dataKey="cliente" width={90}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [decimalParaDisplay(v), "Horas"]}
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  />
                  <Bar dataKey="horas" radius={[0, 6, 6, 0]}>
                    {horasPorCliente.map((_, i) => (
                      <Cell key={i} fill={GREEN_PAL[i % GREEN_PAL.length] + "dd"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-1">
              <User className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-semibold text-foreground">Pendentes por executante</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-4">Distribuição das OS pendentes por consultor</p>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : porExecutante.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg">
                Nenhuma OS pendente encontrada
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={porExecutante}
                    dataKey="quantidade" nameKey="executante"
                    cx="50%" cy="50%"
                    outerRadius={80} innerRadius={44}
                    paddingAngle={2}
                    label={({ percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""}
                    labelLine={false}
                  >
                    {porExecutante.map((_, idx) => (
                      <Cell key={idx} fill={GREEN_PAL[idx % GREEN_PAL.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, name: string) => [`${v} OS`, name]}
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── OS Prontas para apontar (consultor) ── */}
      {!isAdmin && (
        <div
          className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden animate-fade-in"
          style={{ animationDelay: "0.42s" }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="text-[13px] font-semibold text-foreground">OS prontas para seu apontamento</h3>
              {!loading && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {kpis.prontasApontar}
                </span>
              )}
            </div>
            <button
              onClick={() => navigate("/lancamento-os")}
              className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
            >
              Abrir lançamentos <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-20 h-3 rounded bg-muted animate-pulse" />
                  <div className="w-32 h-3 rounded bg-muted animate-pulse" />
                  <div className="w-24 h-3 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : prontasApontar.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2 text-xs">
              <CheckCircle2 className="h-7 w-7 text-primary/30" />
              <span className="font-medium text-foreground">Nenhuma OS pronta para apontar</span>
              <span>Aguarde o RPA abrir novas OS ou verifique os lançamentos.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="p-3 text-left font-semibold text-muted-foreground">Data</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Cliente</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Horário</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Ticket</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Tarefa</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Abertura</th>
                    <th className="p-3 text-left font-semibold text-muted-foreground">Apontamento</th>
                  </tr>
                </thead>
                <tbody>
                  {prontasApontar.map((os) => (
                    <tr
                      key={os.id}
                      onClick={() => navigate("/lancamento-os")}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">{fmtData(os.data_os)}</td>
                      <td className="p-3 whitespace-nowrap font-medium text-foreground">{os.cliente_nome}</td>
                      <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">{os.hora_inicio}–{os.hora_fim}</td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{os.ticket ?? "–"}</td>
                      <td className="p-3 max-w-[200px] truncate text-muted-foreground" title={os.tarefa}>{os.tarefa}</td>
                      <td className="p-3"><StatusAberturaBadge value={os.status_abertura} /></td>
                      <td className="p-3"><StatusOSBadge value={os.status_os} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {kpis.prontasApontar > 15 && (
                <div className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
                  Mostrando 15 de {kpis.prontasApontar}.{" "}
                  <button onClick={() => navigate("/lancamento-os")} className="text-primary hover:underline font-medium">Ver todas</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── OS pendentes hoje ── */}
      <div
        className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden animate-fade-in"
        style={{ animationDelay: "0.47s" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[hsl(var(--amber))]" />
            <h3 className="text-[13px] font-semibold text-foreground">
              {isAdmin ? "OS pendentes hoje" : "Minhas OS pendentes hoje"}
            </h3>
            {!loading && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {kpis.pendentesHoje}
              </span>
            )}
          </div>
          <button onClick={() => navigate("/lancamento-os")} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
            Ver lançamentos <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="w-24 h-3 rounded bg-muted animate-pulse" />
                <div className="w-32 h-3 rounded bg-muted animate-pulse" />
                <div className="w-16 h-3 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : pendentesHoje.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 text-xs">
            <CheckCircle2 className="h-8 w-8 text-primary/30" />
            <span className="font-medium text-foreground">Tudo em dia!</span>
            <span>Nenhuma OS pendente para hoje.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {isAdmin && <th className="p-3 text-left font-semibold text-muted-foreground">Executante</th>}
                  <th className="p-3 text-left font-semibold text-muted-foreground">Cliente</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Horário</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Ticket</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Tarefa</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Abertura</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Apontamento</th>
                </tr>
              </thead>
              <tbody>
                {pendentesHoje.map((os) => (
                  <tr key={os.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    {isAdmin && <td className="p-3 whitespace-nowrap font-medium text-foreground">{os.executante}</td>}
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{os.cliente_nome}</td>
                    <td className="p-3 whitespace-nowrap font-mono text-muted-foreground">{os.hora_inicio}–{os.hora_fim}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{os.ticket ?? "–"}</td>
                    <td className="p-3 max-w-[200px] truncate text-muted-foreground" title={os.tarefa}>{os.tarefa}</td>
                    <td className="p-3"><StatusAberturaBadge value={os.status_abertura} /></td>
                    <td className="p-3"><StatusOSBadge value={os.status_os} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kpis.pendentesHoje > 10 && (
              <div className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
                Mostrando 10 de {kpis.pendentesHoje}.{" "}
                <button onClick={() => navigate("/lancamento-os")} className="text-primary hover:underline font-medium">Ver todas</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── OS com erro RPA ── */}
      {kpis.errosRPA > 0 && (
        <div
          className="bg-card border border-destructive/20 rounded-xl shadow-[var(--shadow-sm)] overflow-hidden animate-fade-in"
          style={{ animationDelay: "0.52s" }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-destructive/20 bg-red-50/50">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <h3 className="text-[13px] font-semibold text-destructive">OS com erro no RPA</h3>
              <span className="text-[10px] font-mono text-destructive/70 bg-red-100 px-1.5 py-0.5 rounded">{kpis.errosRPA}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">Reprocesse manualmente em Abertura Automática</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {isAdmin && <th className="p-3 text-left font-semibold text-muted-foreground">Executante</th>}
                  <th className="p-3 text-left font-semibold text-muted-foreground">Cliente</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Data</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Horário</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Ticket</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Tarefa</th>
                </tr>
              </thead>
              <tbody>
                {errosLista.map((os) => (
                  <tr key={os.id} className="border-b border-border hover:bg-red-50/30 transition-colors">
                    {isAdmin && <td className="p-3 whitespace-nowrap font-medium text-foreground">{os.executante}</td>}
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{os.cliente_nome}</td>
                    <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">{fmtData(os.data_os)}</td>
                    <td className="p-3 font-mono whitespace-nowrap text-muted-foreground">{os.hora_inicio}–{os.hora_fim}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{os.ticket ?? "–"}</td>
                    <td className="p-3 max-w-[200px] truncate text-muted-foreground" title={os.tarefa}>{os.tarefa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Resumo por consultor (admin) — cards estilo ranking ── */}
      {isAdmin && (
        <div
          className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden animate-fade-in"
          style={{ animationDelay: "0.56s" }}
        >
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold text-foreground">Performance por consultor</h3>
            {!loading && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {resumoConsultores.length}
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : resumoConsultores.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
              Nenhum dado disponível.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
              {resumoConsultores.map((r, idx) => {
                const totalR = r.apontadas + r.totalPendentes;
                const pct    = totalR > 0 ? Math.round((r.apontadas / totalR) * 100) : 0;
                const rankColor =
                  idx === 0 ? "border-l-[hsl(var(--amber))]" :
                  idx === 1 ? "border-l-muted-foreground/40" :
                  idx === 2 ? "border-l-[hsl(24,64%,58%)]" :
                              "border-l-border";
                return (
                  <div
                    key={r.executante}
                    className={`bg-background border border-border border-l-4 ${rankColor} rounded-xl p-4 hover:shadow-[var(--shadow-sm)] transition-all`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground/60">#{idx + 1}</span>
                          <p className="text-[13px] font-semibold text-foreground">{r.executante}</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {r.apontadas} apontada{r.apontadas !== 1 ? "s" : ""} · {r.totalPendentes} pendente{r.totalPendentes !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-bold font-mono text-primary">{decimalParaDisplay(r.horasApontadas)}</span>
                        <p className="text-[10px] text-muted-foreground">apontadas</p>
                      </div>
                    </div>

                    {/* Barra de progresso */}
                    <div className="mb-2">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span>Conclusão</span>
                        <span className="font-mono font-semibold">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Mini stats */}
                    <div className="grid grid-cols-3 gap-1 mt-3">
                      <div className="text-center">
                        <p className="text-[11px] font-bold font-mono text-primary">{r.prontasApontar}</p>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Prontas</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] font-bold font-mono text-[hsl(var(--amber))]">{r.pendentesHoje}</p>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Hoje</p>
                      </div>
                      <div className="text-center">
                        <p className={`text-[11px] font-bold font-mono ${r.errosRPA > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {r.errosRPA > 0 ? r.errosRPA : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Erros</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </AppLayout>
  );
}
