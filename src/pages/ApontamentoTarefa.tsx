import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  ClipboardCheck, Loader2, Terminal, X, CheckCircle2,
  AlertTriangle, RefreshCw, Play, Clock, Calendar,
  Building2, Tag, Timer,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type TipoLog = "sucesso" | "erro" | "aviso" | "info";

interface LogEntry {
  id: number;
  tipo: TipoLog;
  mensagem: string;
  hora: string;
}

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
  // da relação com configuracoes_clientes
  url_tarefas?: string | null;
  exp_usuario?: string | null;
  exp_senha?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function decimalParaHHMM(d: number): string {
  if (!d || d <= 0) return "0h";
  const m = Math.round(d * 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${String(min).padStart(2, "0")}m`;
}

const fmtData = (d: string) => {
  if (!d) return "–";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const fmtHora = (h: string) => (h ? h.slice(0, 5) : "–");

// ── Componente ────────────────────────────────────────────────────────────────
export default function ApontamentoTarefa() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [executando, setExecutando] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewAtual, setViewAtual] = useState<"os" | "logs">("os");
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((tipo: TipoLog, mensagem: string) => {
    const hora = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    setLogs((p) => [...p, { id: Date.now(), tipo, mensagem, hora }]);
  }, []);

  useEffect(() => {
    if (viewAtual === "logs") logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, viewAtual]);

  // ── Carregar OS prontas para apontamento ──
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("solicitacoes_os")
        .select(`
          *,
          clientes(nome, configuracoes_clientes(url_tarefas, exp_usuario, exp_senha))
        `)
        .eq("status_abertura", "OS Aberta")
        .neq("status_os", "OS Apontada")
        .order("data_os", { ascending: false })
        .order("hora_inicio", { ascending: false })
        .limit(300);

      if (error) throw error;

      const lista: Apontamento[] = (data ?? []).map((a: any) => {
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
      addLog("info", `${lista.length} OS prontas para apontamento carregadas.`);
    } catch (err: any) {
      addLog("erro", `Erro ao carregar: ${err.message}`);
      toast({ title: "Erro ao carregar", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [addLog, toast]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Selecionar / desselecionar ──
  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTodos = () => {
    if (selecionados.size === apontamentos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(apontamentos.map((a) => a.id)));
    }
  };

  // ── Executar apontamento ──
  const handleExecutar = async () => {
    const alvo = selecionados.size > 0
      ? apontamentos.filter((a) => selecionados.has(a.id))
      : apontamentos;

    if (alvo.length === 0) {
      toast({ title: "Nenhuma OS selecionada", variant: "destructive" });
      return;
    }

    const semUrl = alvo.filter((a) => !a.url_tarefas);
    if (semUrl.length > 0) {
      addLog(
        "aviso",
        `${semUrl.length} OS sem URL de Tarefas configurada: ${semUrl.map((a) => a.cliente_nome).join(", ")}. Configure em Cadastros → Clientes → Configurações.`,
      );
    }

    const itens = alvo
      .filter((a) => a.url_tarefas)
      .map((a) => ({
        apontamento_id: a.id,
        executante: a.executante,
        cliente_id: a.cliente_id,
        cliente_nome: a.cliente_nome,
        data_os: a.data_os,
        hora_inicio: a.hora_inicio,
        hora_fim: a.hora_fim,
        ticket: a.ticket,
        tarefa: a.tarefa,
        observacoes: a.observacoes,
        url_tarefas: a.url_tarefas,
        exp_usuario: a.exp_usuario,
        exp_senha: a.exp_senha,
      }));

    if (itens.length === 0) {
      toast({
        title: "Nenhuma OS com URL de Tarefas configurada",
        description: "Configure a URL de Tarefas em Cadastros → Clientes → Configurações.",
        variant: "destructive",
      });
      return;
    }

    setExecutando(true);
    setViewAtual("logs");
    addLog("info", `Disparando apontamento automático para ${itens.length} OS...`);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const resp = await fetch(`${apiUrl}/executar-apontamento`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(itens),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? "Erro desconhecido no servidor.");
      }

      const resultado = await resp.json();
      addLog("sucesso", `Apontamento iniciado em background. ID de execução: ${resultado.execucao_id}`);
      toast({ title: "Apontamento iniciado!", description: "O RPA está processando as OS em background." });

      // Polling simples dos logs no Supabase
      _iniciarPollingLogs(resultado.execucao_id);
    } catch (err: any) {
      addLog("erro", `Falha ao iniciar apontamento: ${err.message}`);
      toast({ title: "Erro ao iniciar", description: err.message, variant: "destructive" });
      setExecutando(false);
    }
  };

  const _iniciarPollingLogs = useCallback((execucaoId: string) => {
    let tentativas = 0;
    const MAX = 120; // ~4 minutos
    const interval = setInterval(async () => {
      tentativas++;
      try {
        const { data } = await supabase
          .from("logs")
          .select("tipo, mensagem, criado_em")
          .eq("execucao_id", execucaoId)
          .eq("modulo", "automacao_os")
          .order("criado_em", { ascending: true });

        if (data && data.length > 0) {
          const ultimo = data[data.length - 1];
          const tipoFinal = ["sucesso", "aviso"].includes(ultimo.tipo) &&
            (ultimo.mensagem.toLowerCase().includes("finalizado") ||
             ultimo.mensagem.toLowerCase().includes("apontamento finalizado"));

          if (tipoFinal || tentativas >= MAX) {
            clearInterval(interval);
            setExecutando(false);
            carregar();
            setSelecionados(new Set());
          }
        }

        if (tentativas >= MAX) {
          clearInterval(interval);
          setExecutando(false);
        }
      } catch {
        // ignorar erros de polling
      }
    }, 2000);
  }, [carregar]);

  // ── KPIs ──
  const total = apontamentos.length;
  const totalHoras = apontamentos.reduce((acc, a) => acc + Number(a.horas_executadas || 0), 0);
  const semUrl = apontamentos.filter((a) => !a.url_tarefas).length;

  const TIPO_COR: Record<string, string> = {
    os: "bg-blue-100 text-blue-700",
    ticket: "bg-orange-100 text-orange-700",
    pipefy: "bg-violet-100 text-violet-700",
    outro: "bg-slate-100 text-slate-600",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout
      title="Apontamento Automático"
      subtitle={`${total} OS prontas para apontar`}
    >
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: ClipboardCheck, label: "Prontas", value: total,                           color: "bg-primary/10 text-primary",      delay: 0 },
          { icon: Timer,          label: "Total horas",   value: decimalParaHHMM(totalHoras),  color: "bg-blue-500/10 text-blue-600",    delay: 0.05 },
          { icon: CheckCircle2,   label: "Selecionadas",  value: selecionados.size || total,   color: "bg-green-500/10 text-green-600",  delay: 0.1 },
          { icon: AlertTriangle,  label: "Sem URL",       value: semUrl,                        color: "bg-amber-500/10 text-amber-600",  delay: 0.15 },
        ].map(({ icon: Icon, label, value, color, delay }) => (
          <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
            <Card className="border-border bg-card">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2.5 shadow-[var(--shadow-sm)]"
      >
        <span className="text-[11px] text-muted-foreground font-mono flex-1">
          {viewAtual === "os"
            ? `${total} OS prontas${selecionados.size > 0 ? ` · ${selecionados.size} selecionada${selecionados.size !== 1 ? "s" : ""}` : " · todas serão apontadas"}`
            : `${logs.length} evento${logs.length !== 1 ? "s" : ""} no log`}
        </span>

        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-background">
          <button
            onClick={() => setViewAtual("os")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${viewAtual === "os" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            OS
          </button>
          <button
            onClick={() => setViewAtual("logs")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${viewAtual === "logs" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Terminal className="h-3.5 w-3.5" />
            Log
            {logs.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${viewAtual === "logs" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {logs.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={carregar}
          disabled={loading || executando}
          title="Atualizar"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={handleExecutar}
          disabled={executando || loading || total === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {executando
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Apontando...</>
            : <><Play className="h-3.5 w-3.5" /> Iniciar Apontamento</>}
        </button>
      </motion.div>

      {/* ── Tabela de OS ── */}
      {viewAtual === "os" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">OS prontas para apontamento</p>
                <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                  Status: OS Aberta · Pendente Apontamento
                </p>
              </div>
            </div>
            {total > 0 && (
              <button
                onClick={toggleTodos}
                className="text-[11px] text-primary hover:underline font-medium"
              >
                {selecionados.size === total ? "Desmarcar todas" : "Selecionar todas"}
              </button>
            )}
          </div>

          <DataTable<Apontamento>
            columns={[
              {
                key: "id", header: "", width: 40, filterable: false,
                render: (_, row) => (
                  <input
                    type="checkbox"
                    checked={selecionados.has(row.id)}
                    onChange={() => toggleSelecionado(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                ),
              },
              {
                key: "data_os", header: "Data", width: 90,
                render: (v) => <span className="font-mono text-[12px]">{fmtData(String(v))}</span>,
              },
              {
                key: "hora_inicio", header: "Início", width: 72, filterable: false,
                render: (v) => <span className="font-mono text-muted-foreground text-[12px]">{fmtHora(String(v))}</span>,
              },
              {
                key: "hora_fim", header: "Fim", width: 72, filterable: false,
                render: (v) => <span className="font-mono text-muted-foreground text-[12px]">{fmtHora(String(v))}</span>,
              },
              {
                key: "executante", header: "Executante", width: 130,
                render: (v) => <span className="font-medium text-[13px] block truncate">{String(v)}</span>,
              },
              {
                key: "cliente_nome", header: "Cliente", width: 140,
                render: (v) => <span className="font-medium text-[13px] block truncate">{String(v)}</span>,
              },
              {
                key: "tipo_atividade", header: "Tipo", width: 80, filterable: false,
                render: (v) => (
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${TIPO_COR[String(v)] ?? TIPO_COR.outro}`}>
                    {String(v ?? "os").toUpperCase()}
                  </span>
                ),
              },
              {
                key: "ticket", header: "Ticket / OS", width: 110,
                render: (v) => <span className="font-mono text-[12px] text-muted-foreground">{v || "–"}</span>,
              },
              {
                key: "tarefa", header: "Tarefa", width: 200,
                render: (v) => <span className="block truncate text-[12px]">{String(v)}</span>,
              },
              {
                key: "horas_executadas", header: "Horas", width: 80, filterable: false,
                render: (v) => (
                  <span className="font-mono font-bold text-primary text-[13px]">
                    {decimalParaHHMM(Number(v))}
                  </span>
                ),
              },
              {
                key: "url_tarefas" as any, header: "URL Tarefas", width: 100, filterable: false,
                render: (_, row) => row.url_tarefas ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full border border-green-200">
                    <CheckCircle2 className="h-3 w-3" /> Configurada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                    <AlertTriangle className="h-3 w-3" /> Faltando
                  </span>
                ),
              },
            ] as ColumnDef<Apontamento>[]}
            data={apontamentos}
            loading={loading}
            skeletonRows={5}
            emptyMessage="Nenhuma OS pronta para apontamento. Verifique se há OS com status 'OS Aberta'."
            footer={
              total > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  Selecione as OS que deseja apontar e clique em "Iniciar Apontamento"
                </span>
              ) : null
            }
          />
        </section>
      )}

      {/* ── Painel de Logs ── */}
      {viewAtual === "logs" && (
        <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Log de Execução</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {logs.length}
                </span>
              )}
            </div>
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
              >
                <X className="h-3 w-3" /> Limpar
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-[480px] font-mono">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                <Terminal className="h-8 w-8 opacity-20" />
                <span className="text-xs">Nenhuma execução registrada ainda.</span>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 px-5 py-2.5 transition-colors ${
                      log.tipo === "sucesso" ? "hover:bg-green-50/40" :
                      log.tipo === "erro"    ? "hover:bg-red-50/40" :
                      log.tipo === "aviso"   ? "hover:bg-amber-50/40" :
                                              "hover:bg-blue-50/40"
                    }`}
                  >
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap pt-0.5 min-w-[58px]">
                      {log.hora}
                    </span>
                    <span className={`text-[10px] font-bold uppercase whitespace-nowrap px-2 py-0.5 rounded-full ${
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
        </section>
      )}
    </AppLayout>
  );
}
