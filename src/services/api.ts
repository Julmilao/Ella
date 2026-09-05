// API service — wraps calls to the Python backend (main.py)
// Configure VITE_API_URL in .env (defaults to http://localhost:8000)

import { supabase } from "@/integrations/supabase/client";
import { formatBrasiliaDateTime } from "@/lib/brasilia-time";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const token = await getAuthToken();

  return fetch(url, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function apiErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.json();
    if (data?.detail) return `${fallback}: ${data.detail}`;
  } catch {
    // resposta sem corpo JSON
  }
  return `${fallback} (${resp.status})`;
}

export interface Cliente {
  empresa: string;
  experience_url_etapas: string;
  experience_url_pedidos?: string;
  ativo: boolean;
}

export interface SchedulerJob {
  id: string;
  nome: string;
  cliente: string;
  periodo: string;
  diaEnvio: number;
  schedule: string;
  resumo: string;
}

export interface ServerClock {
  timezone: string;
  currentTime: string;
  currentTimeMs: number;
}

const SCHEDULER_UPDATED_EVENT = "scheduler:updated";
const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

function getScheduleResumo(periodo: string | null, diaEnvio: number): string {
  const periodoNorm = (periodo ?? "mensal").toLowerCase();

  if (periodoNorm === "semanal") {
    const diaSemana = WEEKDAY_LABELS[diaEnvio] ?? `Dia ${diaEnvio}`;
    return `Toda ${diaSemana} às 08:00`;
  }

  if (periodoNorm === "quinzenal") {
    const segundoDia = diaEnvio + 14;
    return segundoDia <= 28
      ? `Dias ${diaEnvio} e ${segundoDia} às 08:00`
      : `Dia ${diaEnvio} às 08:00`;
  }

  return `Dia ${diaEnvio} às 08:00`;
}

function getScheduleCron(periodo: string | null, diaEnvio: number): string {
  const periodoNorm = (periodo ?? "mensal").toLowerCase();

  if (periodoNorm === "semanal") {
    return `cron[day_of_week='${diaEnvio}', hour='8', minute='0']`;
  }

  if (periodoNorm === "quinzenal") {
    const segundoDia = diaEnvio + 14;
    const dias = segundoDia <= 28 ? `${diaEnvio},${segundoDia}` : `${diaEnvio}`;
    return `cron[day='${dias}', hour='8', minute='0']`;
  }

  return `cron[day='${diaEnvio}', hour='8', minute='0']`;
}

// ── Clientes via Supabase (fonte canônica) ──
export async function fetchClientesSupabase(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("clientes")
    .select("nome, ativo, configuracoes_clientes(url_abertura_os, url_saldo_horas)")
    .eq("ativo", true)
    .order("nome", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((c: any) => {
    const cfg = Array.isArray(c.configuracoes_clientes)
      ? c.configuracoes_clientes[0]
      : c.configuracoes_clientes;
    return {
      empresa: c.nome,
      experience_url_etapas: cfg?.url_abertura_os ?? "",
      experience_url_pedidos: cfg?.url_saldo_horas ?? "",
      ativo: c.ativo,
    };
  });
}

export interface OSData {
  dados: Record<string, string>[];
  aba: string;
}

export interface SaldoResult {
  codigo: string | null;
  hrs_alocadas: string | null;
  hrs_consumidas: string | null;
  saldo_horas: string | null;
  tipo_operacao: string | null;
  tipo: string | null;
  data_mais_recente: string | null;
  ultima_atualizacao: string | null;
}

// ── Abas ──
export async function fetchAbas(): Promise<string[]> {
  const resp = await apiFetch("/abas");
  if (!resp.ok) throw new Error("Falha ao carregar abas");
  const data = await resp.json();
  return data.abas || [];
}

// ── OS ──
export async function fetchOS(aba?: string, force = false): Promise<OSData> {
  const params = new URLSearchParams();
  if (aba) params.set("aba", aba);
  if (force) params.set("force", "true");
  const query = params.toString();
  const resp = await apiFetch(`/os${query ? "?" + query : ""}`);
  if (!resp.ok) throw new Error("Falha ao carregar OS");
  return resp.json();
}

export async function fetchServerClock(): Promise<ServerClock> {
  const resp = await apiFetch("/system/time", { cache: "no-store" });
  if (!resp.ok) throw new Error(`Falha ao sincronizar horario do backend (${resp.status})`);

  const data = await resp.json();
  return {
    timezone: String(data.timezone ?? "America/Sao_Paulo"),
    currentTime: String(data.current_time ?? ""),
    currentTimeMs: Number(data.current_time_ms ?? 0),
  };
}

// ── Clientes ──
export async function fetchClientes(): Promise<Cliente[]> {
  const resp = await apiFetch("/clientes");
  if (!resp.ok) throw new Error("Falha ao carregar clientes");
  const data = await resp.json();

  const clientes = data.data || data.clientes || [];
  return clientes.map((c: any) => {
    const cfg = Array.isArray(c.configuracoes_clientes)
      ? c.configuracoes_clientes[0]
      : c.configuracoes_clientes;

    return {
      empresa: c.nome ?? c.empresa ?? "",
      experience_url_etapas: cfg?.url_abertura_os ?? c.experience_url_etapas ?? "",
      experience_url_pedidos: cfg?.url_saldo_horas ?? c.experience_url_pedidos ?? "",
      ativo: c.ativo ?? true,
    };
  });
}

export async function salvarCliente(cliente: { empresa: string; experience_url_etapas: string; ativo: boolean }) {
  const resp = await apiFetch("/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cliente),
  });
  if (!resp.ok) throw new Error("Erro ao salvar cliente");
  return resp.json();
}

export async function toggleClienteAtivo(empresa: string, ativoAtual: boolean) {
  const resp = await apiFetch(`/clientes/${encodeURIComponent(empresa)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ativo: !ativoAtual }),
  });
  if (!resp.ok) throw new Error("Erro ao atualizar status");
  return resp.json();
}

// ── Saldo de horas ──
export async function consultarSaldo(empresa: string): Promise<{ status: string; empresa: string; dados: SaldoResult }> {
  const resp = await apiFetch(`/saldo/${encodeURIComponent(empresa)}`);
  if (!resp.ok) throw new Error(await apiErrorMessage(resp, `Erro ao consultar saldo de ${empresa}`));
  return resp.json();
}

export async function consultarSaldoMultiplo(empresas: string[]): Promise<{
  status: string;
  consultadas: number;
  dados: Record<string, SaldoResult>;
}> {
  const resp = await apiFetch("/saldo-multiplo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(empresas),
  });
  if (!resp.ok) throw new Error(await apiErrorMessage(resp, "Erro ao consultar saldos multiplos"));
  return resp.json();
}

// ── Cache ──
export async function fetchCache(): Promise<Record<string, SaldoResult>> {
  const resp = await apiFetch("/cache");
  if (!resp.ok) throw new Error("Falha ao carregar cache");
  return resp.json();
}

// ── Execução ──
export async function executarAutomacao(
  payload: any[],
  execucaoId?: string | null,
  usuarioId?: string | null,
) {
  let resp: Response;
  try {
    resp = await apiFetch("/executar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itens: payload,
        execucao_id: execucaoId ?? null,
        usuario_id: usuarioId ?? null,
      }),
    });
  } catch {
    throw new Error(
      "API indisponivel ou reiniciando durante a execucao. Aguarde o Render finalizar o deploy/restart e consulte os logs da execucao antes de tentar novamente."
    );
  }

  if (!resp.ok) {
    let detalhe = "";
    try {
      const data = await resp.json();
      detalhe = data?.detail ? ` Detalhe: ${data.detail}` : "";
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(`Falha ao disparar automacao.${detalhe}`);
  }
  return resp.json();
}

export async function fetchExecStatus(
  execucaoId: string,
  after: number = 0,
): Promise<{ status: string; logs: string[]; total: number; resultado: any } | null> {
  try {
    const resp = await apiFetch(`/executar/status/${execucaoId}?after=${after}`);
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function fetchSchedulerJobs(): Promise<SchedulerJob[]> {
  // Try live endpoint first, fall back to Supabase query
  try {
    const resp = await apiFetch("/scheduler/jobs");
    if (resp.ok) {
      const data = await resp.json();
      return (data.jobs ?? []).map((j: any) => ({
        id:       j.id,
        nome:     j.nome ?? j.id,
        cliente:  j.id,
        periodo:  "—",
        diaEnvio: 0,
        schedule: j.trigger ?? "—",
        resumo:   j.proximo ? `Próximo: ${formatBrasiliaDateTime(j.proximo)} BRT` : "—",
      }));
    }
  } catch {
    // backend offline — fall through to Supabase
  }

  const { data, error } = await supabase
    .from("status_report_configs")
    .select("id, periodo, dia_envio, ativo, clientes(nome)")
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => {
    const cliente  = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;
    const periodo  = (item.periodo ?? "mensal") as string;
    const diaEnvio = Number(item.dia_envio ?? 1);
    return {
      id:       item.id,
      nome:     `sr_job_${item.id}`,
      cliente:  cliente?.nome ?? "Cliente sem nome",
      periodo,
      diaEnvio,
      schedule: getScheduleCron(periodo, diaEnvio),
      resumo:   getScheduleResumo(periodo, diaEnvio),
    };
  });
}

export function notifySchedulerUpdated() {
  if (typeof window === "undefined") return;
  // Fire-and-forget backend reload so APScheduler picks up changes immediately
  apiFetch("/scheduler/reload", { method: "POST" }).catch(() => {/* backend may be offline */});
  window.dispatchEvent(new CustomEvent(SCHEDULER_UPDATED_EVENT));
}

export function subscribeSchedulerUpdated(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  const listener = () => callback();
  window.addEventListener(SCHEDULER_UPDATED_EVENT, listener);
  return () => window.removeEventListener(SCHEDULER_UPDATED_EVENT, listener);
}
