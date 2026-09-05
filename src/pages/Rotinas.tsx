import { useEffect, useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { notifySchedulerUpdated } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  CalendarClock, Plus, Pencil, Trash2, Search, Star, Loader2,
  CheckCircle2, BarChart3, Bot, HelpCircle, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type TipoModelo        = "status_report" | "lancamento_os";
type TipoAgendamento   = "periodo" | "intervalo" | "horarios_fixos";
type PeriodoReferencia = "mes_atual" | "janela_fixa" | "desde_ultimo_envio";

interface ModeloRotina {
  id:                 number;
  nome:               string;
  tipo:               TipoModelo;
  periodo:            string;
  periodo_referencia: PeriodoReferencia;
  dia_envio:          number;
  scheduler_hora:     string;
  horarios_dia:       string[];
  tipo_agendamento:   TipoAgendamento;
  intervalo_minutos:  number | null;
  enviar_sem_os:      boolean;
  is_padrao:          boolean;
  ativo:              boolean;
  criado_em:          string;
}

// ── Constantes de display ──────────────────────────────────────────────────────

const TIPO_INFO: Record<TipoModelo, { label: string; desc: string; color: string }> = {
  status_report: {
    label: "Status Report",
    desc:  "Envia relatório de atividades por e-mail para o cliente",
    color: "bg-pink-100 text-pink-700",
  },
  lancamento_os: {
    label: "Abertura Automática",
    desc:  "Abre ordens de serviço automaticamente via RPA",
    color: "bg-violet-100 text-violet-700",
  },
};

const AGENDAMENTO_INFO: Record<TipoAgendamento, { label: string; sub: string }> = {
  periodo:       { label: "Por período",     sub: "Dia fixo do mês" },
  intervalo:     { label: "Por intervalo",   sub: "A cada X min/h" },
  horarios_fixos: { label: "Horários fixos", sub: "Ex: 9h, 12h, 18h" },
};

const PERIODO_REF_INFO: Record<PeriodoReferencia, {
  label: string; desc: string; sub: string; tag: string; tagColor: string;
}> = {
  mes_atual: {
    label: "Atividades do mês atual",
    desc:  "O relatório mostra TODAS as atividades registradas no mês corrente — do dia 1 até a data do envio. Quando o mês vira, começa do zero automaticamente.",
    sub:   "Envio semanal em Janeiro → 1º envio: jan/01-07 · 2º envio: jan/01-14 · 3º envio: jan/01-21 · Em fevereiro recomeça do zero.",
    tag:   "Recomendado", tagColor: "bg-primary/10 text-primary",
  },
  desde_ultimo_envio: {
    label: "Apenas atividades novas",
    desc:  "Inclui somente as OS registradas DEPOIS do último envio. Cada relatório mostra só o que é novo, sem repetir atividades já enviadas anteriormente.",
    sub:   "Enviou jan/07 → próximo envio (jan/14) mostra apenas as OS de jan/08 até jan/14.",
    tag:   "Incremental", tagColor: "bg-blue-100 text-blue-700",
  },
  janela_fixa: {
    label: "Janela de dias fixos",
    desc:  "Sempre olha para trás um número fixo de dias, independente do mês. A janela NÃO acumula — cada envio sempre mostra os mesmos últimos X dias.",
    sub:   "Semanal → sempre os últimos 7 dias · Quinzenal → últimos 14 dias · Mensal → últimos 30 dias.",
    tag:   "Retroativo", tagColor: "bg-amber-100 text-amber-700",
  },
};

const PERIODO_REF_LABELS: Record<PeriodoReferencia, string> = {
  mes_atual:          "Mês atual acumulado",
  desde_ultimo_envio: "Atividades novas",
  janela_fixa:        "Janela de dias fixos",
};

// Frequência de disparo para horários fixos
const FREQ_INFO: Record<string, { label: string; sub: string; cron: string }> = {
  diario:    { label: "Diariamente",    sub: "Todo dia",        cron: "Diário"   },
  semanal:   { label: "Semanalmente",   sub: "A cada 7 dias",   cron: "Semanal"  },
  quinzenal: { label: "Quinzenalmente", sub: "A cada 14 dias",  cron: "Quinzenal"},
  mensal:    { label: "Mensalmente",    sub: "1× ao mês",       cron: "Mensal"   },
};

// Chips de horário sugeridos
const HORARIOS_SUGERIDOS = [
  "07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00",
  "17:00","18:00","19:00","20:00",
];

// ── Formulário inicial ─────────────────────────────────────────────────────────

const FORM_VAZIO = {
  nome:               "",
  tipo:               "status_report" as TipoModelo,
  periodo:            "mensal",
  periodo_referencia: "mes_atual"     as PeriodoReferencia,
  dia_envio:          5,
  scheduler_hora:     "08:00",
  horarios_dia:       [] as string[],
  tipo_agendamento:   "horarios_fixos" as TipoAgendamento,
  intervalo_minutos:  60 as number | null,
  enviar_sem_os:      false,
  is_padrao:          false,
  ativo:              true,
  customHora:         "",
};

// ── Componente ────────────────────────────────────────────────────────────────

export default function Rotinas() {
  const { toast } = useToast();

  const [modelos, setModelos]     = useState<ModeloRotina[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busca, setBusca]         = useState("");
  const [ajudaOpen, setAjudaOpen] = useState(false);

  const [formOpen, setFormOpen]   = useState(false);
  const [editando, setEditando]   = useState<ModeloRotina | null>(null);
  const [form, setForm]           = useState({ ...FORM_VAZIO });
  const [salvando, setSalvando]   = useState(false);

  const [deleteId, setDeleteId]   = useState<number | null>(null);
  const [deletando, setDeletando] = useState(false);

  // ── Carregar ──────────────────────────────────────────────────────────────

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("modelos_rotina")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      toast({ title: "Erro ao carregar modelos", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const lista: ModeloRotina[] = (data ?? []).map((row: any) => ({
      ...row,
      tipo:             (row.tipo || "status_report") as TipoModelo,
      tipo_agendamento: (row.tipo_agendamento || "horarios_fixos") as TipoAgendamento,
      periodo_referencia: (row.periodo_referencia || "mes_atual") as PeriodoReferencia,
      horarios_dia: Array.isArray(row.horarios_dia)
        ? row.horarios_dia
        : (typeof row.horarios_dia === "string" && row.horarios_dia.startsWith("[")
            ? JSON.parse(row.horarios_dia)
            : [row.scheduler_hora || "08:00"]),
    }));

    setModelos(lista);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const filtrados   = modelos.filter((m) =>
    busca === "" || m.nome.toLowerCase().includes(busca.toLowerCase()),
  );
  const totalAtivos = modelos.filter((m) => m.ativo).length;
  const padraoAtual = modelos.find((m) => m.is_padrao && m.ativo);

  // ── Form helpers ──────────────────────────────────────────────────────────

  function abrirNovo() {
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setFormOpen(true);
  }

  function abrirEdicao(m: ModeloRotina) {
    setEditando(m);
    setForm({
      nome:               m.nome,
      tipo:               m.tipo,
      periodo:            m.periodo,
      periodo_referencia: m.periodo_referencia,
      dia_envio:          m.dia_envio,
      scheduler_hora:     m.scheduler_hora,
      horarios_dia:       [...m.horarios_dia],
      tipo_agendamento:   m.tipo_agendamento,
      intervalo_minutos:  m.intervalo_minutos,
      enviar_sem_os:      m.enviar_sem_os,
      is_padrao:          m.is_padrao,
      ativo:              m.ativo,
      customHora:         "",
    });
    setFormOpen(true);
  }

  function toggleHorario(h: string) {
    setForm((f) => {
      const existe = f.horarios_dia.includes(h);
      return {
        ...f,
        horarios_dia: existe
          ? f.horarios_dia.filter((x) => x !== h)
          : [...f.horarios_dia, h].sort(),
      };
    });
  }

  function adicionarCustomHora() {
    const h = form.customHora.trim();
    if (!h || form.horarios_dia.includes(h)) return;
    setForm((f) => ({
      ...f,
      horarios_dia: [...f.horarios_dia, h].sort(),
      customHora: "",
    }));
  }

  function removerHorario(h: string) {
    setForm((f) => ({ ...f, horarios_dia: f.horarios_dia.filter((x) => x !== h) }));
  }

  // ── Salvar ────────────────────────────────────────────────────────────────

  async function salvar() {
    if (!form.nome.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" }); return;
    }
    if (form.tipo_agendamento === "horarios_fixos" && form.horarios_dia.length === 0) {
      toast({ title: "Adicione pelo menos um horário", variant: "destructive" }); return;
    }

    setSalvando(true);

    if (form.is_padrao) {
      for (const m of modelos.filter((m) => m.is_padrao && m.id !== editando?.id)) {
        await supabase.from("modelos_rotina").update({ is_padrao: false }).eq("id", m.id);
      }
    }

    const horarios = form.horarios_dia.filter(Boolean);
    const payload = {
      nome:               form.nome.trim(),
      tipo:               form.tipo,
      periodo:            form.periodo,
      periodo_referencia: form.periodo_referencia,
      dia_envio:          form.dia_envio,
      scheduler_hora:     horarios[0] || form.scheduler_hora || "08:00",
      horarios_dia:       horarios,
      tipo_agendamento:   form.tipo_agendamento,
      intervalo_minutos:  form.tipo_agendamento === "intervalo" ? form.intervalo_minutos : null,
      enviar_sem_os:      form.enviar_sem_os,
      is_padrao:          form.is_padrao,
      ativo:              form.ativo,
    };

    const { error } = editando
      ? await supabase.from("modelos_rotina").update(payload).eq("id", editando.id)
      : await supabase.from("modelos_rotina").insert(payload);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editando ? "Modelo atualizado" : "Modelo criado" });
      setFormOpen(false);
      notifySchedulerUpdated();
      void carregar();
    }
    setSalvando(false);
  }

  // ── Toggle ativo ──────────────────────────────────────────────────────────

  async function toggleAtivo(m: ModeloRotina) {
    const { error } = await supabase
      .from("modelos_rotina").update({ ativo: !m.ativo }).eq("id", m.id);
    if (error) toast({ title: "Erro ao atualizar", variant: "destructive" });
    else { notifySchedulerUpdated(); void carregar(); }
  }

  // ── Deletar ───────────────────────────────────────────────────────────────

  async function confirmarDelete() {
    if (!deleteId) return;
    setDeletando(true);
    const { error } = await supabase.from("modelos_rotina").delete().eq("id", deleteId);
    if (error) toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
    else { toast({ title: "Modelo removido" }); notifySchedulerUpdated(); void carregar(); }
    setDeleteId(null);
    setDeletando(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const showPeriodo = form.tipo === "status_report";

  return (
    <AppLayout
      title="Modelos de Rotina"
      subtitle="Templates de agendamento e relatórios automáticos por cliente"
    >
      {/* Ajuda colapsável */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
          onClick={() => setAjudaOpen((o) => !o)}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">O que são Modelos de Rotina?</p>
            <p className="text-[11px] text-muted-foreground">Clique para entender como funcionam os relatórios automáticos</p>
          </div>
          <span className="text-xs text-muted-foreground">{ajudaOpen ? "▲" : "▼"}</span>
        </button>
        {ajudaOpen && (
          <div className="border-t border-border px-5 py-4 text-[13px] leading-relaxed text-muted-foreground">
            <p>Um <strong className="text-foreground">Modelo de Rotina</strong> define <em>quando</em> e <em>como</em> o sistema deve disparar relatórios automáticos ou abrir OS via RPA. O agendador lê esses modelos e gerencia os jobs automaticamente.</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
        <span className="inline-flex h-2 w-2 rounded-full bg-amber-400" />
        <span>Nenhuma automação em execução</span>
        <span>·</span>
        <span>Para iniciar, acesse <strong className="text-foreground">Abertura Automática</strong> e execute o robô.</span>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar modelo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9 bg-card border-border rounded-xl"
          />
        </div>
        <Button onClick={abrirNovo} className="gap-2 rounded-xl">
          <Plus className="h-4 w-4" />
          Novo Modelo
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Total de Modelos</p>
            <p className="text-2xl font-bold text-foreground">{modelos.length}</p>
          </div>
          <CalendarClock className="h-8 w-8 text-primary/30" />
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Ativos</p>
            <p className="text-2xl font-bold text-foreground">{totalAtivos}</p>
          </div>
          <CheckCircle2 className="h-8 w-8 text-primary/30" />
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Padrão Atual</p>
            <p className="text-[13px] font-bold text-amber-500 truncate">{padraoAtual?.nome ?? "—"}</p>
          </div>
          <Star className="h-8 w-8 text-amber-400/30" />
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[2fr_150px_160px_160px_80px_72px_72px] gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Nome</span>
          <span>Tipo</span>
          <span>Agendamento</span>
          <span>OS do relatório</span>
          <span>Padrão</span>
          <span>Ativo</span>
          <span>Ações</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />Carregando modelos…
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <BarChart3 className="h-10 w-10 opacity-20" />
            <p className="text-sm">Nenhum modelo encontrado. Crie o primeiro!</p>
          </div>
        ) : (
          filtrados.map((m) => {
            const tipo     = TIPO_INFO[m.tipo] ?? TIPO_INFO.status_report;
            const horarios = m.horarios_dia.length ? m.horarios_dia : [m.scheduler_hora];
            return (
              <div
                key={m.id}
                className="grid grid-cols-[2fr_150px_160px_160px_80px_72px_72px] gap-2 items-center border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate text-[13px] font-medium text-foreground">{m.nome}</span>
                </div>
                <span>
                  <Badge className={cn("text-[11px] font-medium border-0", tipo.color)}>{tipo.label}</Badge>
                </span>
                <span className="text-[12px] text-foreground truncate">
                  {m.tipo_agendamento === "horarios_fixos" && (
                    <span className="font-medium text-primary mr-1">
                      {FREQ_INFO[m.periodo]?.label ?? m.periodo}
                      {" · "}
                    </span>
                  )}
                  <span className="font-mono">{horarios.join(" · ")}</span>
                </span>
                <span>
                  {m.tipo === "status_report" ? (
                    <Badge variant="outline" className="text-[11px] border-border text-muted-foreground">
                      {PERIODO_REF_LABELS[m.periodo_referencia] ?? m.periodo_referencia}
                    </Badge>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">—</span>
                  )}
                </span>
                <span>
                  {m.is_padrao && (
                    <Badge className="bg-amber-100 text-amber-700 border-0 text-[11px] gap-1">
                      <Star className="h-3 w-3" />Padrão
                    </Badge>
                  )}
                </span>
                <span>
                  <Switch checked={m.ativo} onCheckedChange={() => toggleAtivo(m)} className="data-[state=checked]:bg-primary" />
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" onClick={() => abrirEdicao(m)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(m.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Dialog: Criar / Editar ──────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Modelo de Rotina" : "Novo Modelo de Rotina"}</DialogTitle>
            <DialogDescription>
              {editando ? `Editando: ${editando.nome}` : "Defina nome, tipo e agendamento do modelo."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">

            {/* TIPO DE ROTINA */}
            <div className="space-y-2">
              <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Tipo de Rotina <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-3">
                {(["status_report", "lancamento_os"] as TipoModelo[]).map((t) => {
                  const info = TIPO_INFO[t];
                  const sel  = form.tipo === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tipo: t }))}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-all",
                        sel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30 hover:bg-muted/20"
                      )}
                    >
                      <p className={cn("text-[13px] font-semibold", sel ? "text-primary" : "text-foreground")}>{info.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{info.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* NOME */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Ex: Status Report Padrão"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>

            {/* AGENDAMENTO */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Agendamento <span className="text-destructive">*</span>
                </Label>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["periodo", "intervalo", "horarios_fixos"] as TipoAgendamento[]).map((ag) => {
                  const info = AGENDAMENTO_INFO[ag];
                  const sel  = form.tipo_agendamento === ag;
                  return (
                    <button
                      key={ag}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tipo_agendamento: ag }))}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-all",
                        sel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30 hover:bg-muted/20"
                      )}
                    >
                      <p className={cn("text-[12px] font-semibold", sel ? "text-primary" : "text-foreground")}>{info.label}</p>
                      <p className="text-[11px] text-muted-foreground">{info.sub}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Por intervalo — campo de minutos */}
            {form.tipo_agendamento === "intervalo" && (
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Intervalo (minutos)</Label>
                <Input
                  type="number"
                  min={5}
                  value={form.intervalo_minutos ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, intervalo_minutos: Number(e.target.value) || null }))}
                  placeholder="Ex: 60"
                />
              </div>
            )}

            {/* Por período — dia do mês */}
            {form.tipo_agendamento === "periodo" && (
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Dia do mês</Label>
                <Input
                  type="number"
                  min={1} max={28}
                  value={form.dia_envio}
                  onChange={(e) => setForm((f) => ({ ...f, dia_envio: Number(e.target.value) }))}
                />
              </div>
            )}

            {/* HORÁRIOS DO DIA — frequência + chips */}
            {form.tipo_agendamento === "horarios_fixos" && (
              <div className="space-y-3">

                {/* Frequência */}
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Frequência de Disparo <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["diario", "semanal", "quinzenal", "mensal"] as const).map((f) => {
                      const info = FREQ_INFO[f];
                      const sel  = form.periodo === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, periodo: f }))}
                          className={cn(
                            "rounded-xl border p-2.5 text-center transition-all",
                            sel
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/30 hover:bg-muted/20"
                          )}
                        >
                          <p className={cn("text-[12px] font-semibold", sel ? "text-primary" : "text-foreground")}>
                            {info.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{info.sub}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Horários do Dia <span className="text-destructive">*</span>
                  </Label>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </div>

                {/* Chips sugeridos */}
                <div className="flex flex-wrap gap-1.5">
                  {HORARIOS_SUGERIDOS.map((h) => {
                    const sel = form.horarios_dia.includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => toggleHorario(h)}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-[12px] font-mono font-medium transition-all",
                          sel
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>

                {/* Input manual */}
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={form.customHora}
                    onChange={(e) => setForm((f) => ({ ...f, customHora: e.target.value }))}
                    className="w-32 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-1.5"
                    onClick={adicionarCustomHora}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar
                  </Button>
                </div>

                {form.horarios_dia.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Nenhum horário adicionado. Clique nas sugestões ou adicione manualmente.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-muted/20 p-3">
                    {form.horarios_dia.map((h) => (
                      <span
                        key={h}
                        className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[12px] font-mono font-medium text-primary"
                      >
                        {h}
                        <button type="button" onClick={() => removerHorario(h)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PERÍODO DO RELATÓRIO — apenas Status Report */}
            {showPeriodo && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Período do Relatório
                  </Label>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  {(["mes_atual", "desde_ultimo_envio", "janela_fixa"] as PeriodoReferencia[]).map((p) => {
                    const info = PERIODO_REF_INFO[p];
                    const sel  = form.periodo_referencia === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, periodo_referencia: p }))}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left transition-all",
                          sel ? "border-primary bg-primary/5" : "border-border hover:border-primary/30 hover:bg-muted/30"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-foreground">{info.label}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", info.tagColor)}>
                            {info.tag}
                          </span>
                        </div>
                        <p className="text-[12px] text-muted-foreground leading-snug">{info.desc}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground/70 italic leading-snug">{info.sub}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Enviar sem OS — apenas Status Report */}
            {showPeriodo && (
              <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">Enviar sem OS</p>
                    <p className="text-[11px] text-muted-foreground">Dispara mesmo quando não há OS no período</p>
                  </div>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <Switch
                  checked={form.enviar_sem_os}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, enviar_sem_os: v }))}
                />
              </div>
            )}

            {/* Modelo padrão */}
            <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <div>
                <p className="text-[13px] font-medium text-foreground">Modelo padrão</p>
                <p className="text-[11px] text-muted-foreground">Usado quando nenhum modelo específico for selecionado</p>
              </div>
              <Switch checked={form.is_padrao} onCheckedChange={(v) => setForm((f) => ({ ...f, is_padrao: v }))} />
            </div>

            {/* Ativo */}
            <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <div>
                <p className="text-[13px] font-medium text-foreground">Modelo ativo</p>
                <p className="text-[11px] text-muted-foreground">Modelos inativos não geram jobs no agendador</p>
              </div>
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editando ? "Salvar alterações" : "Criar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Confirmar delete ────────────────────────────────────────────── */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Remover modelo</DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarDelete} disabled={deletando}>
              {deletando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
