import * as XLSX from "xlsx";
import {
  OSRow,
  agruparPorEmpresa,
  calcularResumo,
  minutosParaHoras,
  formatarAba,
  nomeArquivoBase,
} from "./exportHelpers";

export function exportarExcelGeral(dados: OSRow[], aba: string): void {
  const wb = XLSX.utils.book_new();

  const wsData = [
    ["Cliente", "Executante", "Tarefa", "Data", "Hora Início", "Hora Fim", "Executado"],
    ...dados.map((l) => [
      l["cliente"] || l["Cliente"] || "",
      l["executante"] || "",
      l["Tarefa"] || "",
      l["Data"] || "",
      l["Hora inicio"] || "",
      l["Hora fim"] || "",
      l["Executado"] || "",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [20, 20, 50, 12, 10, 10, 10].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "Geral");
  XLSX.writeFile(wb, `${nomeArquivoBase(aba)}_GERAL.xlsx`);
}

export function exportarExcelPorEmpresa(
  dados: OSRow[],
  aba: string,
  empresasFiltro?: string[]
): void {
  const porEmpresa = agruparPorEmpresa(dados);
  const wb = XLSX.utils.book_new();

  Object.entries(porEmpresa)
    .filter(([emp]) => !empresasFiltro || empresasFiltro.includes(emp))
    .forEach(([empresa, linhas]) => {
      const resumo = calcularResumo(linhas);

      const wsData = [
        ["Empresa:", empresa],
        ["Período:", formatarAba(aba)],
        ["Total de horas:", minutosParaHoras(resumo.minutos)],
        ["Total de atividades:", resumo.qtd],
        [],
        ["Data", "Tarefa", "Hora Início", "Hora Fim", "Executado", "Executante"],
        ...linhas.map((l) => [
          l["Data"] || "",
          l["Tarefa"] || "",
          l["Hora inicio"] || "",
          l["Hora fim"] || "",
          l["Executado"] || "",
          l["executante"] || "",
        ]),
      ];

      const sheetName = empresa.slice(0, 31).replace(/[/*?[\]\\:]/g, "");
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [12, 50, 10, 10, 10, 20].map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

  XLSX.writeFile(wb, `${nomeArquivoBase(aba)}_EMPRESAS.xlsx`);
}
