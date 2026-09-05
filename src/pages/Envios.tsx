import { useEffect, useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Send, Search, Filter, Building2, Calendar, CheckCircle2,
  XCircle, Clock, AlertTriangle, Eye, FileText, Users, RefreshCw, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EnvioDestinatario = {
  id: string;
  email: string;
  status_entrega: "entregue" | "pendente" | "erro";
};

type Envio = {
  id: string;
  config_id: string;
  status: "enviado" | "erro" | "pendente";
  enviado_em: string;
  periodo_inicio: string;
  periodo_fim: string;
  erro_msg: string | null;
  pdf_path: string | null;
  // joined
  status_report_configs: {
    clientes: { nome: string } | null;
  } | null;
  sr_envio_destinatarios: EnvioDestinatario[];
};

// ── Configs visuais ────────────────────────────────────────────────────────────

const statusConfig = {
  enviado: { label: "Enviado", icon: CheckCircle2, variant: "default" as const },
  erro: { label: "Erro", icon: XCircle, variant: "destructive" as const },
  pendente: { label: "Pendente", icon: Clock, variant: "secondary" as const },
};

const entregaConfig = {
  entregue: { label: "Entregue", color: "text-accent" },
  erro: { label: "Erro", color: "text-destructive" },
  pendente: { label: "Pendente", color: "text-amber-500" },
};

// ── Componente ─────────────────────────────────────────────────────────────────

export default function Envios() {
  const { toast } = useToast();
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroCliente, setFiltroCliente] = useState("todos");
  const [detalheOpen, setDetalheOpen] = useState(false);
  const [envioSelecionado, setEnvioSelecionado] = useState<Envio | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sr_envios")
      .select(`
        *,
        status_report_configs (
          clientes ( nome )
        ),
        sr_envio_destinatarios ( id, email, status_entrega )
      `)
      .order("enviado_em", { ascending: false });

    if (error) {
      toast({ title: "Erro ao carregar envios", description: error.message, variant: "destructive" });
    } else {
      setEnvios((data ?? []) as Envio[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  const clientes = [...new Set(
    envios
      .map((e) => e.status_report_configs?.clientes?.nome)
      .filter(Boolean) as string[]
  )];

  const filtered = envios.filter((e) => {
    const nome = e.status_report_configs?.clientes?.nome ?? "";
    const matchBusca = nome.toLowerCase().includes(busca.toLowerCase());
    const matchStatus = filtroStatus === "todos" || e.status === filtroStatus;
    const matchCliente = filtroCliente === "todos" || nome === filtroCliente;
    return matchBusca && matchStatus && matchCliente;
  });

  const stats = {
    total: envios.length,
    enviados: envios.filter((e) => e.status === "enviado").length,
    erros: envios.filter((e) => e.status === "erro").length,
    pendentes: envios.filter((e) => e.status === "pendente").length,
  };

  return (
    <AppLayout title="Histórico de Envios" subtitle="Monitore todos os envios de Status Report">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="w-32">
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="enviado">Enviados</SelectItem>
              <SelectItem value="erro">Com Erro</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroCliente} onValueChange={setFiltroCliente}>
            <SelectTrigger className="w-44">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              {clientes.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total de Envios", value: stats.total, icon: Send, color: "text-primary" },
          { label: "Enviados", value: stats.enviados, icon: CheckCircle2, color: "text-accent" },
          { label: "Com Erro", value: stats.erros, icon: XCircle, color: "text-destructive" },
          { label: "Pendentes", value: stats.pendentes, icon: Clock, color: "text-amber-500" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-muted-foreground font-medium block">{s.label}</span>
                <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <s.icon className="h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Carregando envios...</span>
        </div>
      )}

      {/* Table */}
      {!loading && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cliente</TableHead>
                    <TableHead className="text-xs">Período</TableHead>
                    <TableHead className="text-xs text-center">Status</TableHead>
                    <TableHead className="text-xs">Destinatários</TableHead>
                    <TableHead className="text-xs">Enviado em</TableHead>
                    <TableHead className="text-xs text-center">PDF</TableHead>
                    <TableHead className="text-xs text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence>
                    {filtered.map((envio, i) => {
                      const sc = statusConfig[envio.status];
                      const cliente = envio.status_report_configs?.clientes?.nome ?? "—";
                      return (
                        <motion.tr
                          key={envio.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-border hover:bg-muted/50 cursor-pointer"
                          onClick={() => { setEnvioSelecionado(envio); setDetalheOpen(true); }}
                        >
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              {cliente}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(envio.periodo_inicio).toLocaleDateString("pt-BR")} – {new Date(envio.periodo_fim).toLocaleDateString("pt-BR")}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={sc.variant} className="text-[10px] gap-1">
                              <sc.icon className="h-3 w-3" />
                              {sc.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {envio.sr_envio_destinatarios.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {envio.sr_envio_destinatarios.slice(0, 2).map((d) => (
                                  <span key={d.id} className="font-mono text-[11px] text-foreground truncate max-w-[180px]">
                                    {d.email}
                                  </span>
                                ))}
                                {envio.sr_envio_destinatarios.length > 2 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    +{envio.sr_envio_destinatarios.length - 2} mais
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(envio.enviado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          </TableCell>
                          <TableCell className="text-center">
                            {envio.pdf_path ? (
                              <FileText className="h-4 w-4 text-primary mx-auto" />
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => { setEnvioSelecionado(envio); setDetalheOpen(true); }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Send className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhum envio encontrado</p>
        </div>
      )}

      {/* Dialog Detalhe */}
      <Dialog open={detalheOpen} onOpenChange={setDetalheOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Detalhes do Envio
            </DialogTitle>
            <DialogDescription>
              {envioSelecionado?.status_report_configs?.clientes?.nome ?? "—"}
            </DialogDescription>
          </DialogHeader>
          {envioSelecionado && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded-lg p-3">
                  <span className="text-[11px] text-muted-foreground block mb-0.5">Status</span>
                  <Badge variant={statusConfig[envioSelecionado.status].variant} className="text-[10px] gap-1">
                    {statusConfig[envioSelecionado.status].label}
                  </Badge>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <span className="text-[11px] text-muted-foreground block mb-0.5">Enviado em</span>
                  <span className="text-sm font-medium">
                    {new Date(envioSelecionado.enviado_em).toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="bg-muted rounded-lg p-3 col-span-2">
                  <span className="text-[11px] text-muted-foreground block mb-0.5">Período</span>
                  <span className="text-sm font-medium">
                    {new Date(envioSelecionado.periodo_inicio).toLocaleDateString("pt-BR")} – {new Date(envioSelecionado.periodo_fim).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>

              {envioSelecionado.erro_msg && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-semibold text-destructive">Mensagem de Erro</span>
                  </div>
                  <p className="text-xs text-destructive/80 font-mono">{envioSelecionado.erro_msg}</p>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Destinatários ({envioSelecionado.sr_envio_destinatarios.length})
                </h4>
                {envioSelecionado.sr_envio_destinatarios.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum destinatário registrado.</p>
                ) : (
                  <div className="space-y-2">
                    {envioSelecionado.sr_envio_destinatarios.map((d) => (
                      <div key={d.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                        <span className="text-xs font-mono">{d.email}</span>
                        <span className={`text-[11px] font-medium ${entregaConfig[d.status_entrega].color}`}>
                          {entregaConfig[d.status_entrega].label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
