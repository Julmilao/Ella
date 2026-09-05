import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, Plus, Trash2, Pencil, Check, Loader2, X, Globe, User } from "lucide-react";

// ── Tipos exportados ──────────────────────────────────────────────────────────

export type Operador =
  | "igual" | "diferente"
  | "contem" | "nao_contem"
  | "comeca_com" | "termina_com"
  | "vazio" | "nao_vazio";

export interface Regra {
  coluna: string;
  operador: Operador;
  valor: string;
}

export interface FiltroSalvo {
  id: string;
  nome: string;
  global: boolean;
  usuario_id: string;
  regras: Regra[];
  criado_em: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const OPERADORES: { value: Operador; label: string }[] = [
  { value: "contem",      label: "contém" },
  { value: "nao_contem",  label: "não contém" },
  { value: "igual",       label: "igual a" },
  { value: "diferente",   label: "diferente de" },
  { value: "comeca_com",  label: "começa com" },
  { value: "termina_com", label: "termina com" },
  { value: "vazio",       label: "está vazio" },
  { value: "nao_vazio",   label: "não está vazio" },
];

const REGRA_VAZIA: Regra = { coluna: "", operador: "contem", valor: "" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function normChave(s: string): string {
  return (s || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Aplica um conjunto de regras (AND) sobre uma linha de dados. */
export function aplicarFiltro(row: Record<string, unknown>, regras: Regra[]): boolean {
  return regras.every((regra) => {
    const chave = normChave(regra.coluna);
    const entrada = Object.entries(row).find(([k]) => normChave(k) === chave);
    const cel = String(entrada?.[1] ?? "").toLowerCase().trim();
    const val = String(regra.valor ?? "").toLowerCase().trim();
    switch (regra.operador) {
      case "igual":       return cel === val;
      case "diferente":   return cel !== val;
      case "contem":      return cel.includes(val);
      case "nao_contem":  return !cel.includes(val);
      case "comeca_com":  return cel.startsWith(val);
      case "termina_com": return cel.endsWith(val);
      case "vazio":       return cel === "" || cel === "–";
      case "nao_vazio":   return cel !== "" && cel !== "–";
      default:            return true;
    }
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  colunasDisponiveis: string[];
  filtroAtivo: FiltroSalvo | null;
  onFiltroChange: (filtro: FiltroSalvo | null) => void;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function FiltroAutomacaoOS({
  colunasDisponiveis,
  filtroAtivo,
  onFiltroChange,
}: Props) {
  const { toast } = useToast();
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [filtros, setFiltros]       = useState<FiltroSalvo[]>([]);
  const [loading, setLoading]       = useState(false);
  const [formOpen, setFormOpen]     = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [form, setForm] = useState<{
    nome: string;
    global: boolean;
    regras: Regra[];
  }>({ nome: "", global: false, regras: [{ ...REGRA_VAZIA }] });

  // ── Carrega filtros do Supabase ─────────────────────────────────────────────

  const carregarFiltros = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("filtros_automacao_os")
        .select("*")
        .order("criado_em", { ascending: false });
      if (error) throw error;
      setFiltros((data ?? []) as FiltroSalvo[]);
    } catch {
      toast({ title: "Erro ao carregar filtros", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (sheetOpen) carregarFiltros();
  }, [sheetOpen, carregarFiltros]);

  // ── Abre form ──────────────────────────────────────────────────────────────

  function abrirNovo() {
    setEditandoId(null);
    setForm({ nome: "", global: false, regras: [{ ...REGRA_VAZIA }] });
    setFormOpen(true);
  }

  function abrirEditar(f: FiltroSalvo) {
    setEditandoId(f.id);
    setForm({
      nome: f.nome,
      global: f.global,
      regras: f.regras.length ? f.regras.map((r) => ({ ...r })) : [{ ...REGRA_VAZIA }],
    });
    setFormOpen(true);
  }

  // ── Salva ──────────────────────────────────────────────────────────────────

  async function salvar() {
    if (!form.nome.trim()) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    const regrasValidas = form.regras.filter((r) => r.coluna.trim());
    if (!regrasValidas.length) {
      toast({ title: "Adicione ao menos uma regra com coluna definida", variant: "destructive" });
      return;
    }
    setSalvando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const payload = {
        nome: form.nome.trim(),
        global: form.global,
        regras: regrasValidas,
        usuario_id: user.id,
      };

      const { error } = editandoId
        ? await supabase.from("filtros_automacao_os").update(payload).eq("id", editandoId)
        : await supabase.from("filtros_automacao_os").insert(payload);

      if (error) throw error;

      toast({ title: editandoId ? "Filtro atualizado" : "Filtro criado" });
      setFormOpen(false);
      await carregarFiltros();

      // Se editou o filtro ativo, sincroniza nome/regras
      if (editandoId && filtroAtivo?.id === editandoId) {
        const { data } = await supabase
          .from("filtros_automacao_os").select("*").eq("id", editandoId).single();
        if (data) onFiltroChange(data as FiltroSalvo);
      }
    } catch (err: any) {
      toast({ title: "Erro ao salvar filtro", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  // ── Deleta ─────────────────────────────────────────────────────────────────

  async function deletar(id: string) {
    const { error } = await supabase.from("filtros_automacao_os").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao deletar filtro", variant: "destructive" });
      return;
    }
    if (filtroAtivo?.id === id) onFiltroChange(null);
    setFiltros((prev) => prev.filter((f) => f.id !== id));
    setConfirmDelete(null);
  }

  // ── Helpers de form ────────────────────────────────────────────────────────

  function addRegra() {
    setForm((p) => ({ ...p, regras: [...p.regras, { ...REGRA_VAZIA }] }));
  }

  function removeRegra(i: number) {
    setForm((p) => ({ ...p, regras: p.regras.filter((_, idx) => idx !== i) }));
  }

  function updateRegra(i: number, campo: keyof Regra, valor: string) {
    setForm((p) => ({
      ...p,
      regras: p.regras.map((r, idx) => (idx === i ? { ...r, [campo]: valor } : r)),
    }));
  }

  const meusFiltros    = filtros.filter((f) => !f.global);
  const globais        = filtros.filter((f) => f.global);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ─── Botão / chip ativo ─── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filtroAtivo
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {filtroAtivo ? filtroAtivo.nome : "Filtros"}
            {filtroAtivo && (
              <span
                role="button"
                aria-label="Limpar filtro"
                onClick={(e) => { e.stopPropagation(); onFiltroChange(null); }}
                className="ml-0.5 rounded-full hover:bg-primary-foreground/20 p-0.5"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        </SheetTrigger>

        {/* ─── Sheet de listagem ─── */}
        <SheetContent side="right" className="w-80 sm:w-96 flex flex-col gap-0 p-0">
          <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-sm font-semibold">Filtros salvos</SheetTitle>
              <button
                onClick={abrirNovo}
                className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                <Plus className="h-3.5 w-3.5" /> Novo filtro
              </button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtros.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Filter className="h-8 w-8 opacity-20" />
                <span className="text-xs">Nenhum filtro salvo ainda.</span>
                <span className="text-[11px] opacity-60">
                  Crie um para filtrar a tabela rapidamente.
                </span>
              </div>
            ) : (
              <>
                {meusFiltros.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <User className="h-3 w-3" /> Meus filtros
                    </p>
                    <div className="space-y-1.5">
                      {meusFiltros.map((f) => (
                        <FiltroItem
                          key={f.id}
                          filtro={f}
                          ativo={filtroAtivo?.id === f.id}
                          confirmandoDelete={confirmDelete === f.id}
                          onAplicar={() => { onFiltroChange(f); setSheetOpen(false); }}
                          onEditar={() => abrirEditar(f)}
                          onIniciarDelete={() => setConfirmDelete(f.id)}
                          onCancelarDelete={() => setConfirmDelete(null)}
                          onConfirmarDelete={() => deletar(f.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {globais.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Compartilhados
                    </p>
                    <div className="space-y-1.5">
                      {globais.map((f) => (
                        <FiltroItem
                          key={f.id}
                          filtro={f}
                          ativo={filtroAtivo?.id === f.id}
                          confirmandoDelete={confirmDelete === f.id}
                          onAplicar={() => { onFiltroChange(f); setSheetOpen(false); }}
                          onEditar={() => abrirEditar(f)}
                          onIniciarDelete={() => setConfirmDelete(f.id)}
                          onCancelarDelete={() => setConfirmDelete(null)}
                          onConfirmarDelete={() => deletar(f.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Dialog de criação/edição ─── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editandoId ? "Editar filtro" : "Novo filtro"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Nome */}
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                placeholder="Ex: Pendentes do João"
                value={form.nome}
                onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                className="text-xs h-8"
                autoFocus
              />
            </div>

            {/* Global */}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-xs font-medium">Compartilhar com todos</p>
                <p className="text-[11px] text-muted-foreground">Outros usuários poderão usar este filtro</p>
              </div>
              <Switch
                checked={form.global}
                onCheckedChange={(v) => setForm((p) => ({ ...p, global: v }))}
              />
            </div>

            {/* Regras */}
            <div className="space-y-2">
              <Label className="text-xs">
                Regras{" "}
                <span className="text-muted-foreground font-normal">(todas devem ser verdadeiras)</span>
              </Label>

              {form.regras.map((regra, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {/* Coluna */}
                  {colunasDisponiveis.length > 0 ? (
                    <Select
                      value={regra.coluna}
                      onValueChange={(v) => updateRegra(i, "coluna", v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-[130px] flex-shrink-0">
                        <SelectValue placeholder="Coluna" />
                      </SelectTrigger>
                      <SelectContent>
                        {colunasDisponiveis.map((col) => (
                          <SelectItem key={col} value={col} className="text-xs">
                            {col}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="Coluna"
                      value={regra.coluna}
                      onChange={(e) => updateRegra(i, "coluna", e.target.value)}
                      className="h-7 text-xs w-[110px] flex-shrink-0"
                    />
                  )}

                  {/* Operador */}
                  <Select
                    value={regra.operador}
                    onValueChange={(v) => updateRegra(i, "operador", v as Operador)}
                  >
                    <SelectTrigger className="h-7 text-xs w-[130px] flex-shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERADORES.map((op) => (
                        <SelectItem key={op.value} value={op.value} className="text-xs">
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Valor */}
                  {!["vazio", "nao_vazio"].includes(regra.operador) && (
                    <Input
                      placeholder="Valor"
                      value={regra.valor}
                      onChange={(e) => updateRegra(i, "valor", e.target.value)}
                      className="h-7 text-xs flex-1 min-w-0"
                    />
                  )}

                  {/* Remover regra */}
                  {form.regras.length > 1 && (
                    <button
                      onClick={() => removeRegra(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded shrink-0"
                      aria-label="Remover regra"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              <button
                onClick={addRegra}
                className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar regra
              </button>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setFormOpen(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Salvar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Item de filtro na lista ───────────────────────────────────────────────────

function FiltroItem({
  filtro,
  ativo,
  confirmandoDelete,
  onAplicar,
  onEditar,
  onIniciarDelete,
  onCancelarDelete,
  onConfirmarDelete,
}: {
  filtro: FiltroSalvo;
  ativo: boolean;
  confirmandoDelete: boolean;
  onAplicar: () => void;
  onEditar: () => void;
  onIniciarDelete: () => void;
  onCancelarDelete: () => void;
  onConfirmarDelete: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
        ativo
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-secondary/40"
      }`}
      onClick={onAplicar}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{filtro.nome}</span>
          {filtro.global && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium whitespace-nowrap shrink-0">
              global
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {filtro.regras.length} regra{filtro.regras.length !== 1 ? "s" : ""}
        </p>
      </div>

      {ativo && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}

      {/* Ações — stopPropagation para não aplicar ao clicar */}
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {confirmandoDelete ? (
          <>
            <button
              onClick={onConfirmarDelete}
              className="px-2 py-0.5 text-[10px] rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Deletar
            </button>
            <button
              onClick={onCancelarDelete}
              className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEditar}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Editar filtro"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={onIniciarDelete}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Deletar filtro"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
