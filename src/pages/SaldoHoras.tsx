import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { fetchClientes, consultarSaldoMultiplo, fetchCache, Cliente, SaldoResult } from "@/services/api";
import { Search, CheckSquare, XSquare, Loader2, Inbox } from "lucide-react";

interface SaldoRow {
  cliente: string;
  codigo: string;
  hrsAlocadas: string;
  hrsConsumidas: string;
  saldo: string;
  tipoOperacao: string;
  tipo: string;
  dataNegociacao: string;
}

function resultToRow(empresa: string, r: SaldoResult): SaldoRow {
  return {
    cliente: empresa,
    codigo: r.codigo || "",
    hrsAlocadas: r.hrs_alocadas || "",
    hrsConsumidas: r.hrs_consumidas || "",
    saldo: r.saldo_horas || "",
    tipoOperacao: r.tipo_operacao || "",
    tipo: r.tipo || "",
    dataNegociacao: r.data_mais_recente || "",
  };
}

export default function SaldoHoras() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selectedEmpresas, setSelectedEmpresas] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("Aguardando seleção...");
  const [saldos, setSaldos] = useState<SaldoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingClientes, setLoadingClientes] = useState(true);

  useEffect(() => {
    Promise.all([fetchClientes(), fetchCache().catch(() => ({}))])
      .then(([data, cache]) => {
        const ativos = data.filter((c) => c.ativo);
        setClientes(ativos);
        const rows: SaldoRow[] = [];
        for (const [empresa, resultado] of Object.entries(cache as Record<string, SaldoResult>)) {
          if (resultado.codigo) rows.push(resultToRow(empresa, resultado));
        }
        if (rows.length) {
          setSaldos(rows);
          setStatus(`${rows.length} registros do cache.`);
        }
      })
      .catch((err) => {
        console.error(err);
        setStatus("Erro ao carregar empresas.");
      })
      .finally(() => setLoadingClientes(false));
  }, []);

  const toggleEmpresa = (empresa: string) => {
    setSelectedEmpresas((prev) => {
      const next = new Set(prev);
      if (next.has(empresa)) next.delete(empresa);
      else next.add(empresa);
      return next;
    });
  };

  const consultar = useCallback(async () => {
    if (selectedEmpresas.size === 0) {
      setStatus("Selecione ao menos uma empresa.");
      return;
    }
    setLoading(true);
    setStatus(`Consultando ${selectedEmpresas.size} empresa(s)...`);
    try {
      const result = await consultarSaldoMultiplo(Array.from(selectedEmpresas));
      const rows: SaldoRow[] = [];
      for (const [empresa, resultado] of Object.entries(result.dados)) {
        rows.push(resultToRow(empresa, resultado));
      }
      setSaldos(rows);
      setStatus(rows.length ? `${rows.length} registros encontrados.` : "Nenhum registro encontrado.");
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Erro ao consultar saldos.");
    } finally {
      setLoading(false);
    }
  }, [selectedEmpresas]);

  return (
    <AppLayout title="Saldo de Horas" subtitle="Análise automática de pedidos – FAP">
      {/* Company selection */}
      <section className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-sm)]">
        <h3 className="text-sm font-semibold text-foreground mb-3">Selecione as empresas</h3>

        <div className="max-h-[240px] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
          {loadingClientes ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />
            ))
          ) : (
            clientes.map((c) => (
              <label
                key={c.empresa}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-all border ${
                  selectedEmpresas.has(c.empresa)
                    ? "bg-[hsl(var(--green-light))] border-primary text-primary font-semibold"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedEmpresas.has(c.empresa)}
                  onChange={() => toggleEmpresa(c.empresa)}
                  className="accent-primary rounded"
                />
                {c.empresa}
              </label>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedEmpresas(new Set(clientes.map((c) => c.empresa)))}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-[hsl(var(--green-light))] transition-all"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Selecionar Todas
          </button>
          <button
            onClick={() => setSelectedEmpresas(new Set())}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-[hsl(var(--green-light))] transition-all"
          >
            <XSquare className="h-3.5 w-3.5" />
            Limpar
          </button>
          <button
            onClick={consultar}
            disabled={loading || selectedEmpresas.size === 0}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {loading ? "Consultando..." : "Consultar Selecionadas"}
          </button>
        </div>
      </section>

      {/* Status */}
      <section className="bg-card border border-border rounded-xl p-3 shadow-[var(--shadow-sm)]">
        <div className="text-xs text-muted-foreground">{status}</div>
      </section>

      {/* Results table */}
      <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                {["Cliente","Código","Hrs Alocadas","Hrs Consumidas","Saldo","Tipo Operação","Tipo","Data Negociação"].map((h) => (
                  <th key={h} className="p-3 text-left font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {saldos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-8 w-8 text-muted-foreground/30" />
                      {loading ? "Carregando..." : "Nenhum dado disponível ainda"}
                    </div>
                  </td>
                </tr>
              ) : (
                saldos.map((row, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-medium">{row.cliente}</td>
                    <td className="p-3 font-mono">{row.codigo}</td>
                    <td className="p-3 font-mono">{row.hrsAlocadas}</td>
                    <td className="p-3 font-mono">{row.hrsConsumidas}</td>
                    <td className="p-3 font-mono font-semibold text-primary">{row.saldo}</td>
                    <td className="p-3">{row.tipoOperacao}</td>
                    <td className="p-3">{row.tipo}</td>
                    <td className="p-3 font-mono">{row.dataNegociacao}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  );
}
