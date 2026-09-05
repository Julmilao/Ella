import jsPDF from "jspdf";
import {
  OSRow,
  agruparPorEmpresa,
  calcularResumo,
  minutosParaHoras,
  formatarAba,
  nomeArquivoBase,
} from "./exportHelpers";

// Logo Sankhya (JPEG) — mesma usada em export_pdf.js
const LOGO_B64 =
  "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";

type RGB = [number, number, number];

// Paleta fiel ao export_pdf.js original
const CORES: Record<string, RGB> = {
  verde:        [46,  125,  50],
  verdeClaro:   [232, 245, 233],
  verdeMid:     [67,  160,  71],
  verdeMuted:   [165, 214, 167],
  verdeEscuro:  [27,   94,  32],
  cinzaTexto:   [74,  107,  74],
  cinzaMuted:   [138, 168, 138],
  cinzaLinha:   [220, 232, 220],
  branco:       [255, 255, 255],
  preto:        [26,   46,  26],
  linhaAlt:     [245, 248, 245],
  bgPage:       [250, 252, 250],
  bgCapaDark:   [38,   90,  40],
  bgCapaMid:    [52,  120,  55],
};

function fill(doc: jsPDF, cor: RGB) { doc.setFillColor(...cor); }
function stroke(doc: jsPDF, cor: RGB) { doc.setDrawColor(...cor); }
function textColor(doc: jsPDF, cor: RGB) { doc.setTextColor(...cor); }

function drawTriangle(
  doc: jsPDF,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  cor: RGB
) {
  fill(doc, cor);
  doc.lines(
    [[x2 - x1, y2 - y1], [x3 - x2, y3 - y2], [x1 - x3, y1 - y3]],
    x1, y1, [1, 1], "F", true
  );
}

function capa(
  doc: jsPDF,
  empresa: string,
  resumo: { minutos: number; qtd: number; media: number },
  aba: string,
  W: number,
  H: number
) {
  // Fundo
  fill(doc, CORES.bgCapaDark); doc.rect(0, 0, W, H, "F");
  fill(doc, CORES.bgCapaMid);  doc.rect(0, H * 0.60, W, H * 0.40, "F");

  // Corte diagonal
  drawTriangle(doc, 0, H * 0.54, W, H * 0.50, W, H * 0.60, CORES.bgCapaDark);
  drawTriangle(doc, 0, H * 0.54, 0, H * 0.64, W, H * 0.60, CORES.bgCapaMid);

  // Faixas
  fill(doc, CORES.verde); doc.rect(0, 0, 6, H, "F");
  fill(doc, CORES.verde); doc.rect(6, 0, W - 6, 3, "F");

  // Logo (canto superior direito)
  try {
    doc.addImage(LOGO_B64, "JPEG", W - 55, 8, 40, 16);
  } catch {
    textColor(doc, CORES.verdeMuted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Sankhya", W - 20, 18, { align: "right" });
  }

  // "STATUS REPORT"
  textColor(doc, CORES.verdeMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setCharSpace(5);
  doc.text("STATUS REPORT", 20, 24);
  doc.setCharSpace(0);

  // Nome empresa
  textColor(doc, CORES.branco);
  doc.setFont("helvetica", "bold");
  const nLen = empresa.length;
  const fs = nLen <= 15 ? 40 : nLen <= 25 ? 32 : nLen <= 35 ? 26 : 22;
  doc.setFontSize(fs);
  const linhasEmp = doc.splitTextToSize(empresa.toUpperCase(), W - 40);
  doc.text(linhasEmp, 20, 52);
  const alturaNome = 52 + (linhasEmp.length - 1) * (fs * 0.45);

  // Período
  textColor(doc, CORES.verdeMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.text(`Período  ${formatarAba(aba)}`, 20, alturaNome + 18);

  // Data geração
  doc.setFontSize(10);
  textColor(doc, CORES.cinzaMuted);
  doc.text(
    `Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`,
    20, alturaNome + 30
  );

  // KPIs
  const kpiY = H * 0.62;
  textColor(doc, CORES.verdeMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setCharSpace(3);
  doc.text("RESUMO DO PERÍODO", 20, kpiY - 5);
  doc.setCharSpace(0);

  stroke(doc, CORES.verde);
  doc.setLineWidth(0.5);
  doc.line(20, kpiY - 1, W - 20, kpiY - 1);

  const kpis = [
    { valor: minutosParaHoras(resumo.minutos), label: "TOTAL DE HORAS",      sub: "horas registradas no período" },
    { valor: String(resumo.qtd),               label: "ATIVIDADES",          sub: "tarefas concluídas" },
    { valor: minutosParaHoras(resumo.media),   label: "MÉDIA POR ATIVIDADE", sub: "tempo médio por tarefa" },
  ];

  const kpiW = (W - 60) / 3;
  kpis.forEach((k, i) => {
    const x = 20 + i * (kpiW + 10);
    const y = kpiY + 6;

    if (i > 0) {
      stroke(doc, CORES.verde);
      doc.setLineWidth(0.4);
      doc.line(x - 5, y, x - 5, y + 34);
    }

    textColor(doc, CORES.verdeMuted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setCharSpace(1.5);
    doc.text(k.label, x, y + 6);
    doc.setCharSpace(0);

    textColor(doc, CORES.branco);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.text(k.valor, x, y + 24);

    textColor(doc, CORES.cinzaMuted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(k.sub, x, y + 32);
  });

  // Rodapé capa
  fill(doc, CORES.bgCapaDark); doc.rect(0, H - 12, W, 12, "F");
  textColor(doc, CORES.cinzaMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("ELLA OS  ·  Sankhya Experience  ·  Documento gerado automaticamente", 20, H - 4.5);
  textColor(doc, CORES.verdeMuted);
  doc.text("1", W - 20, H - 4.5, { align: "right" });
}

function cabecalho(doc: jsPDF, empresa: string, aba: string, W: number) {
  fill(doc, CORES.verde);      doc.rect(0, 0, 4, 999, "F");
  fill(doc, CORES.bgCapaDark); doc.rect(4, 0, W - 4, 16, "F");

  try { doc.addImage(LOGO_B64, "JPEG", W - 36, 2, 26, 11); } catch { /* */ }

  textColor(doc, CORES.verdeMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setCharSpace(2);
  doc.text("STATUS REPORT", 12, 10);
  doc.setCharSpace(0);

  textColor(doc, CORES.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(empresa, W / 2, 10, { align: "center" });

  textColor(doc, CORES.cinzaMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Período: ${formatarAba(aba)}`, W - 42, 10);
}

function rodape(doc: jsPDF, pageNum: number, total: number, W: number, H: number) {
  fill(doc, CORES.bgPage); doc.rect(0, H - 10, W, 10, "F");
  stroke(doc, CORES.cinzaLinha);
  doc.setLineWidth(0.3);
  doc.line(10, H - 10, W - 10, H - 10);

  textColor(doc, CORES.cinzaMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("ELLA OS  ·  Sankhya Experience", 10, H - 4);
  doc.text(`Página ${pageNum} de ${total}`, W - 10, H - 4, { align: "right" });
}

function tituloSecao(doc: jsPDF, texto: string, y: number, W: number): number {
  fill(doc, CORES.verdeClaro); doc.rect(10, y, W - 20, 9, "F");
  fill(doc, CORES.verde);      doc.rect(10, y, 3, 9, "F");

  textColor(doc, CORES.verdeEscuro);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setCharSpace(1);
  doc.text(texto, 17, y + 6);
  doc.setCharSpace(0);
  return y + 14;
}

function tabela(
  doc: jsPDF,
  linhas: OSRow[],
  startY: number,
  W: number,
  H: number,
  empresa: string,
  aba: string
): number {
  const M = 10, LRG = W - 20;
  const COL_DATA = 20, COL_INI = 16, COL_FIM = 16, COL_EXEC = 18;
  const COL_TAR = LRG - COL_DATA - COL_INI - COL_FIM - COL_EXEC;
  const HDR_H = 9, ROD_H = 14;
  let y = startY;

  function desenharHeader() {
    fill(doc, CORES.verde); doc.rect(M, y, LRG, HDR_H, "F");
    textColor(doc, CORES.branco);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setCharSpace(0.5);
    let x = M + 3;
    doc.text("DATA",   x, y + 6); x += COL_DATA;
    doc.text("TAREFA", x + 2, y + 6); x += COL_TAR;
    doc.text("INÍCIO", x + 2, y + 6); x += COL_INI;
    doc.text("FIM",    x + 2, y + 6); x += COL_FIM;
    doc.text("EXEC.",  x + 2, y + 6);
    doc.setCharSpace(0);
    y += HDR_H;
  }

  function novaPagina() {
    doc.addPage();
    cabecalho(doc, empresa, aba, W);
    y = 24;
    desenharHeader();
  }

  desenharHeader();

  linhas.forEach((l, i) => {
    const tarefa  = String(l["Tarefa"] || "–");
    const linhasT = doc.splitTextToSize(tarefa, COL_TAR - 4);
    const altLinha = Math.max(8, linhasT.length * 4.0 + 4);

    if (y + altLinha > H - ROD_H) novaPagina();

    if (i % 2 === 1) { fill(doc, CORES.linhaAlt); doc.rect(M, y, LRG, altLinha, "F"); }
    stroke(doc, CORES.cinzaLinha);
    doc.setLineWidth(0.15);
    doc.line(M, y + altLinha, M + LRG, y + altLinha);

    const cy = y + 5;
    let cx = M + 3;

    textColor(doc, CORES.cinzaTexto);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(String(l["Data"] || "–"), cx, cy); cx += COL_DATA;

    textColor(doc, CORES.preto);
    doc.text(linhasT, cx + 2, cy, { maxWidth: COL_TAR - 4 }); cx += COL_TAR;

    textColor(doc, CORES.cinzaTexto);
    doc.text(String(l["Hora inicio"] || "–"), cx + 2, cy); cx += COL_INI;
    doc.text(String(l["Hora fim"] || "–"), cx + 2, cy); cx += COL_FIM;

    textColor(doc, CORES.verde);
    doc.setFont("helvetica", "bold");
    doc.text(String(l["Executado"] || "–"), cx + 2, cy);

    y += altLinha;
  });

  return y;
}

function totalBar(doc: jsPDF, resumo: { minutos: number; qtd: number }, y: number, W: number) {
  const M = 10, LRG = W - 20;
  fill(doc, CORES.bgCapaDark); doc.roundedRect(M, y, LRG, 11, 2, 2, "F");
  fill(doc, CORES.verde);      doc.roundedRect(M, y, 4, 11, 1, 1, "F");

  textColor(doc, CORES.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(`TOTAL  ·  ${resumo.qtd} atividade${resumo.qtd !== 1 ? "s" : ""}`, M + 8, y + 7.5);

  textColor(doc, CORES.verdeMuted);
  doc.setFontSize(10);
  doc.text(`${minutosParaHoras(resumo.minutos)} h`, W - M - 5, y + 7.5, { align: "right" });
}

function gerarPdfEmpresa(empresa: string, linhas: OSRow[], aba: string): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const resumo = calcularResumo(linhas);

  capa(doc, empresa, resumo, aba, W, H);

  doc.addPage();
  cabecalho(doc, empresa, aba, W);

  let y = 24;
  y = tituloSecao(doc, "ATIVIDADES REALIZADAS NO PERÍODO", y, W);
  y = tabela(doc, linhas, y, W, H, empresa, aba);

  let yTotal = y + 5;
  if (yTotal + 14 > H - 14) {
    doc.addPage();
    cabecalho(doc, empresa, aba, W);
    yTotal = 24;
  }
  totalBar(doc, resumo, yTotal, W);

  const totalPages = (doc as any).internal.pages.length - 1;
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    rodape(doc, p, totalPages, W, H);
  }

  return doc;
}

export async function exportarPDF(
  dados: OSRow[],
  aba: string,
  empresasFiltro?: string[]
): Promise<void> {
  const porEmpresa = agruparPorEmpresa(dados);
  const base = nomeArquivoBase(aba);

  const entradas = Object.entries(porEmpresa).filter(
    ([emp]) => !empresasFiltro || empresasFiltro.includes(emp)
  );

  for (const [empresa, linhas] of entradas) {
    const nomeEmp = empresa.replace(/[/*?"<>|:\\]/g, "_").toUpperCase();
    const doc = gerarPdfEmpresa(empresa, linhas, aba);
    doc.save(`${base}_${nomeEmp}.pdf`);
    await new Promise((res) => setTimeout(res, 400));
  }
}
