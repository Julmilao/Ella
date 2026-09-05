import { useEffect, useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Eye, Mail, FileText, Copy, Search, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ModeloEmail = {
  id: number;
  assunto: string;
  corpo: string;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
};

const variaveis = [
  "{{cliente}}", "{{contato}}", "{{periodo_inicio}}", "{{periodo_fim}}",
  "{{total_os}}", "{{horas_consumidas}}", "{{saldo_restante}}", "{{limite_minimo}}",
  "{{ticket}}", "{{tarefa}}", "{{data_os}}", "{{executante}}", "{{nome_empresa}}",
];

export default function ModelosEmail() {
  const { toast } = useToast();
  const [modelos, setModelos] = useState<ModeloEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editando, setEditando] = useState<ModeloEmail | null>(null);
  const [previewModelo, setPreviewModelo] = useState<ModeloEmail | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ assunto: "", corpo: "" });

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("modelos_email")
      .select("*")
      .order("assunto");
    if (error) {
      toast({ title: "Erro ao carregar modelos", description: error.message, variant: "destructive" });
    } else {
      setModelos(data ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  const filtered = modelos.filter(
    (m) =>
      m.assunto.toLowerCase().includes(busca.toLowerCase()) ||
      m.corpo.toLowerCase().includes(busca.toLowerCase())
  );

  const abrirNovo = () => {
    setEditando(null);
    setForm({ assunto: "", corpo: "" });
    setDialogOpen(true);
  };

  const abrirEditar = (m: ModeloEmail) => {
    setEditando(m);
    setForm({ assunto: m.assunto, corpo: m.corpo });
    setDialogOpen(true);
  };

  const salvar = async () => {
    setSalvando(true);
    if (editando) {
      const { error } = await supabase
        .from("modelos_email")
        .update({ assunto: form.assunto, corpo: form.corpo, atualizado_em: new Date().toISOString() })
        .eq("id", editando.id);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Modelo atualizado" });
        setDialogOpen(false);
        carregar();
      }
    } else {
      const { error } = await supabase
        .from("modelos_email")
        .insert({ assunto: form.assunto, corpo: form.corpo });
      if (error) {
        toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Modelo criado" });
        setDialogOpen(false);
        carregar();
      }
    }
    setSalvando(false);
  };

  const toggleAtivo = async (m: ModeloEmail) => {
    const { error } = await supabase
      .from("modelos_email")
      .update({ ativo: !m.ativo, atualizado_em: new Date().toISOString() })
      .eq("id", m.id);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } else {
      setModelos((prev) => prev.map((x) => x.id === m.id ? { ...x, ativo: !m.ativo } : x));
    }
  };

  const excluir = async (id: number) => {
    const { error } = await supabase.from("modelos_email").update({ ativo: false }).eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Modelo desativado" });
      setModelos((prev) => prev.map((x) => x.id === id ? { ...x, ativo: false } : x));
    }
  };

  const inserirVariavel = (v: string) => {
    setForm((prev) => ({ ...prev, corpo: prev.corpo + v }));
  };

  return (
    <AppLayout title="Modelos de Email" subtitle="Gerencie templates para envios automáticos">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar modelos..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={abrirNovo} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Modelo
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Total de Modelos", value: modelos.length, color: "text-primary" },
          { label: "Ativos", value: modelos.filter((m) => m.ativo).length, color: "text-accent" },
          { label: "Inativos", value: modelos.filter((m) => !m.ativo).length, color: "text-muted-foreground" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
              <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Carregando modelos...</span>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {filtered.map((modelo, i) => (
              <motion.div
                key={modelo.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={`group relative overflow-hidden transition-shadow hover:shadow-md ${!modelo.ativo ? "opacity-60" : ""}`}>
                  <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Mail className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold truncate">{modelo.assunto}</CardTitle>
                        <span className="text-[11px] text-muted-foreground">
                          Atualizado em {new Date(modelo.atualizado_em).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                    <Badge variant={modelo.ativo ? "default" : "secondary"} className="text-[10px] shrink-0">
                      {modelo.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line leading-relaxed">
                      {modelo.corpo}
                    </p>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">Ativo</span>
                        <Switch checked={modelo.ativo} onCheckedChange={() => toggleAtivo(modelo)} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setPreviewModelo(modelo); setPreviewOpen(true); }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => abrirEditar(modelo)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => excluir(modelo.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhum modelo encontrado</p>
          <p className="text-xs mt-1">Crie um novo modelo para começar</p>
        </div>
      )}

      {/* Dialog Criar/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Modelo" : "Novo Modelo de Email"}</DialogTitle>
            <DialogDescription>Configure o assunto e corpo do template. Use variáveis dinâmicas para personalização.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Assunto</label>
              <Input
                value={form.assunto}
                onChange={(e) => setForm({ ...form, assunto: e.target.value })}
                placeholder="Ex: Status Report - {{cliente}}"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Corpo do Email</label>
              <Textarea
                value={form.corpo}
                onChange={(e) => setForm({ ...form, corpo: e.target.value })}
                placeholder="Escreva o corpo do email..."
                className="min-h-[200px] font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Variáveis Disponíveis</label>
              <div className="flex flex-wrap gap-1.5">
                {variaveis.map((v) => (
                  <button
                    key={v}
                    onClick={() => inserirVariavel(v)}
                    className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-mono cursor-pointer"
                  >
                    <Copy className="h-3 w-3 inline mr-1" />
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !form.assunto.trim() || !form.corpo.trim()}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editando ? "Salvar Alterações" : "Criar Modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Preview do Email
            </DialogTitle>
            <DialogDescription>Visualização do template.</DialogDescription>
          </DialogHeader>
          {previewModelo && (
            <div className="space-y-3">
              <div className="bg-muted rounded-lg p-3">
                <span className="text-[11px] font-medium text-muted-foreground block mb-1">Assunto:</span>
                <span className="text-sm font-semibold text-foreground">{previewModelo.assunto}</span>
              </div>
              <div className="bg-muted rounded-lg p-4">
                <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {previewModelo.corpo}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
