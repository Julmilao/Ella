export type OSRow = Record<string, string>;

export function parsearHoras(str: string): number {
  if (!str || str === "–") return 0;
  const s = String(str).trim();

  // Formato "H:MM" (ex: "0:50", "1:30") — planilha Google Sheets
  if (s.includes(":")) {
    const partes = s.split(":");
    if (partes.length >= 2) {
      return parseInt(partes[0]) * 60 + parseInt(partes[1]);
    }
  }

  // Formato "Xh YYm" (ex: "0h 50m", "1h 30m", "2h", "30m") — banco / UI
  const hMatch = s.match(/(\d+)h/);
  const mMatch = s.match(/(\d+)m/);
  if (hMatch || mMatch) {
    return (hMatch ? parseInt(hMatch[1]) : 0) * 60 + (mMatch ? parseInt(mMatch[1]) : 0);
  }

  return 0;
}

export function minutosParaHoras(min: number): string {
  if (!min || isNaN(min)) return "0:00";
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Formata minutos para exibição legível na UI: "Xh Ym".
 * Ex: 50 → "0h 50m" | 90 → "1h 30m" | 60 → "1h" | 30 → "30m"
 * Mantém minutosParaHoras() separado para uso em exports (PDF/Excel).
 */
export function minParaDisplay(min: number): string {
  if (!min || isNaN(min) || min <= 0) return "0h";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Converte horas decimais para exibição legível: "Xh Ym".
 * Ex: 0.83 → "0h 50m" | 1.5 → "1h 30m" | 2 → "2h"
 */
export function decimalParaDisplay(decimal: number): string {
  return minParaDisplay(Math.round(decimal * 60));
}

export function agruparPorEmpresa(dados: OSRow[]): Record<string, OSRow[]> {
  const mapa: Record<string, OSRow[]> = {};
  dados.forEach((l) => {
    const emp = (l["cliente"] || l["Cliente"] || "").trim() || "Sem cliente";
    if (!mapa[emp]) mapa[emp] = [];
    mapa[emp].push(l);
  });
  return mapa;
}

export function calcularResumo(linhas: OSRow[]) {
  const minutos = linhas.reduce((a, l) => a + parsearHoras(l["Executado"] || "0:00"), 0);
  return {
    minutos,
    qtd: linhas.length,
    media: linhas.length ? Math.round(minutos / linhas.length) : 0,
  };
}

export function formatarAba(aba: string): string {
  if (/^\d{6}$/.test(aba)) return `${aba.slice(0, 2)}/${aba.slice(2)}`;
  return aba;
}

export function nomeArquivoBase(aba: string): string {
  const abaFmt = /^\d{6}$/.test(aba) ? `${aba.slice(0, 2)}-${aba.slice(2)}` : aba;
  return `Status_Report_${abaFmt}`;
}
