from __future__ import annotations

"""
pdf_generator.py — Gera PDFs de Status Report com layout fiel ao exportPDF.ts
(landscape A4, capa escura, tabela DATA/TAREFA/INÍCIO/FIM/EXEC., barra de total).
"""

import io
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

# ── Importação condicional do reportlab ────────────────────────────────────────

try:
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.utils import simpleSplit

    _REPORTLAB_OK = True

    def _rgb(r: int, g: int, b: int):
        return colors.Color(r / 255, g / 255, b / 255)

    # Palette idêntica ao exportPDF.ts → CORES
    C = {
        "verde":       _rgb(46,  125,  50),
        "verdeClaro":  _rgb(232, 245, 233),
        "verdeMuted":  _rgb(165, 214, 167),
        "verdeEscuro": _rgb(27,   94,  32),
        "cinzaTexto":  _rgb(74,  107,  74),
        "cinzaMuted":  _rgb(138, 168, 138),
        "cinzaLinha":  _rgb(220, 232, 220),
        "branco":      colors.white,
        "preto":       _rgb(26,   46,  26),
        "linhaAlt":    _rgb(245, 248, 245),
        "bgPage":      _rgb(250, 252, 250),
        "bgCapaDark":  _rgb(38,   90,  40),
        "bgCapaMid":   _rgb(52,  120,  55),
    }

    PW, PH = landscape(A4)   # 841.89 × 595.28 pt  (297 × 210 mm)

except ImportError:
    _REPORTLAB_OK = False
    logger.warning("reportlab não instalado — geração de PDF desabilitada.")


# ── Helpers de formatação ──────────────────────────────────────────────────────

def _fmt_date(d: str) -> str:
    try:
        return date.fromisoformat(str(d)).strftime("%d/%m/%Y")
    except Exception:
        return str(d)


def _fmt_time(t) -> str:
    """Retorna HH:MM de um valor 'HH:MM:SS' ou já formatado."""
    if not t:
        return "–"
    parts = str(t).split(":")
    return f"{parts[0]}:{parts[1]}" if len(parts) >= 2 else str(t)


def _fmt_horas_kpi(decimal_total: float) -> str:
    """Formato H:MM para KPIs da capa — igual a minutosParaHoras() do TS."""
    total_min = round(decimal_total * 60)
    h, m = divmod(total_min, 60)
    return f"{h}:{m:02d}"


def _periodo_fmt(inicio: str, fim: str) -> str:
    return f"{_fmt_date(inicio)} – {_fmt_date(fim)}"


# ── Utilitários de desenho ─────────────────────────────────────────────────────

def _fill(c, key: str):
    c.setFillColor(C[key])


def _stroke(c, key: str):
    c.setStrokeColor(C[key])


def _spaced(c, text: str, x: float, y: float, font: str, size: float, space_pt: float = 0):
    """Desenha texto com espaçamento extra entre caracteres (equivale a charSpace do jsPDF)."""
    c.setFont(font, size)
    _fill(c, "verdeMuted")  # cor default; o chamador deve setar fill antes
    for ch in text:
        c.drawString(x, y, ch)
        x += c.stringWidth(ch, font, size) + space_pt


def _spaced_color(c, text: str, x: float, y: float, font: str, size: float,
                  color_key: str, space_pt: float = 0):
    """Igual a _spaced mas define a cor internamente."""
    _fill(c, color_key)
    c.setFont(font, size)
    for ch in text:
        c.drawString(x, y, ch)
        x += c.stringWidth(ch, font, size) + space_pt


# ── Capa ───────────────────────────────────────────────────────────────────────

def _draw_cover(c, nome_cliente: str, periodo_str: str,
                total_os: int, total_dec: float, media_dec: float):
    W, H = PW, PH

    # Fundo completo escuro
    _fill(c, "bgCapaDark")
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # 40% inferior em verde médio  (jsPDF: rect(0, H*0.60, W, H*0.40))
    _fill(c, "bgCapaMid")
    c.rect(0, 0, W, H * 0.40, fill=1, stroke=0)

    # Triângulo escuro (corte diagonal)
    # jsPDF: (0, H*0.54) → (W, H*0.50) → (W, H*0.60)  [y=0 no topo]
    # reportlab: flip → (0, H*0.46) → (W, H*0.50) → (W, H*0.40)
    _fill(c, "bgCapaDark")
    p = c.beginPath()
    p.moveTo(0,   H * 0.46)
    p.lineTo(W,   H * 0.50)
    p.lineTo(W,   H * 0.40)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Triângulo médio (completa o corte diagonal)
    # jsPDF: (0, H*0.54) → (0, H*0.64) → (W, H*0.60)
    # reportlab: (0, H*0.46) → (0, H*0.36) → (W, H*0.40)
    _fill(c, "bgCapaMid")
    p = c.beginPath()
    p.moveTo(0, H * 0.46)
    p.lineTo(0, H * 0.36)
    p.lineTo(W, H * 0.40)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Faixa lateral esquerda (6 mm)
    _fill(c, "verde")
    c.rect(0, 0, 6 * mm, H, fill=1, stroke=0)

    # Faixa superior (3 mm)
    c.rect(6 * mm, H - 3 * mm, W - 6 * mm, 3 * mm, fill=1, stroke=0)

    # "STATUS REPORT" espaçado (jsPDF x=20, y=24 do topo)
    _spaced_color(c, "STATUS REPORT", 20 * mm, H - 24 * mm,
                  "Helvetica", 11, "verdeMuted", space_pt=5)

    # Nome do cliente (grande)
    nome_upper = nome_cliente.upper()
    n = len(nome_upper)
    fs = 40 if n <= 15 else (32 if n <= 25 else (26 if n <= 35 else 22))
    _fill(c, "branco")
    c.setFont("Helvetica-Bold", fs)
    lines_nome = simpleSplit(nome_upper, "Helvetica-Bold", fs, W - 40 * mm)
    y_nome = H - 52 * mm
    for idx, ln in enumerate(lines_nome):
        c.drawString(20 * mm, y_nome - idx * (fs * 0.45), ln)
    y_last_nome = y_nome - (len(lines_nome) - 1) * (fs * 0.45)

    # Período (18 mm abaixo do nome)
    _fill(c, "verdeMuted")
    c.setFont("Helvetica", 14)
    c.drawString(20 * mm, y_last_nome - 18 * mm, f"Período  {periodo_str}")

    # Data de geração (30 mm abaixo do nome)
    _fill(c, "cinzaMuted")
    c.setFont("Helvetica", 10)
    today_s = date.today().strftime("%d/%m/%Y")
    c.drawString(20 * mm, y_last_nome - 30 * mm, f"Gerado em {today_s}")

    # Seção KPI — jsPDF: kpiY = H * 0.62 do topo → reportlab: H * 0.38 do fundo
    kpiY = H * 0.38

    # Label "RESUMO DO PERÍODO"
    _spaced_color(c, "RESUMO DO PERÍODO", 20 * mm, kpiY + 5 * mm,
                  "Helvetica", 9, "verdeMuted", space_pt=3)

    # Linha separadora
    _stroke(c, "verde")
    c.setLineWidth(0.5)
    c.line(20 * mm, kpiY + 1 * mm, W - 20 * mm, kpiY + 1 * mm)

    # 3 cartões KPI
    kpi_data = [
        (_fmt_horas_kpi(total_dec),  "TOTAL DE HORAS",     "horas registradas"),
        (str(total_os),               "ATIVIDADES",          "tarefas realizadas"),
        (_fmt_horas_kpi(media_dec),  "MÉDIA / ATIVIDADE",   "tempo médio"),
    ]
    kpiW = (W - 60 * mm) / 3
    for i, (valor, label, sub) in enumerate(kpi_data):
        x = 20 * mm + i * (kpiW + 10 * mm)
        yb = kpiY - 6 * mm    # base Y para este KPI

        if i > 0:
            _stroke(c, "verde")
            c.setLineWidth(0.4)
            c.line(x - 5 * mm, yb, x - 5 * mm, yb - 34 * mm)

        _spaced_color(c, label, x, yb - 6 * mm, "Helvetica", 8.5, "verdeMuted", space_pt=1.5)

        _fill(c, "branco")
        c.setFont("Helvetica-Bold", 30)
        c.drawString(x, yb - 24 * mm, valor)

        _fill(c, "cinzaMuted")
        c.setFont("Helvetica", 8.5)
        c.drawString(x, yb - 32 * mm, sub)

    # Barra inferior da capa (sobre o verde médio)
    _fill(c, "bgCapaDark")
    c.rect(0, 0, W, 12 * mm, fill=1, stroke=0)
    _fill(c, "cinzaMuted")
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, 4.5 * mm,
                 "ELLA OS  ·  Sankhya Experience  ·  Documento gerado automaticamente")
    _fill(c, "verdeMuted")
    c.drawRightString(W - 20 * mm, 4.5 * mm, "1")


# ── Cabeçalho das páginas de conteúdo ─────────────────────────────────────────

def _draw_header(c, nome_cliente: str, periodo_str: str):
    W, H = PW, PH

    _fill(c, "verde")
    c.rect(0, 0, 4 * mm, H, fill=1, stroke=0)

    _fill(c, "bgCapaDark")
    c.rect(4 * mm, H - 16 * mm, W - 4 * mm, 16 * mm, fill=1, stroke=0)

    _spaced_color(c, "STATUS REPORT", 12 * mm, H - 10 * mm,
                  "Helvetica", 7.5, "verdeMuted", space_pt=2)

    _fill(c, "branco")
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(W / 2, H - 10 * mm, nome_cliente)

    _fill(c, "cinzaMuted")
    c.setFont("Helvetica", 7.5)
    c.drawString(W - 42 * mm, H - 10 * mm, f"Período: {periodo_str}")


# ── Rodapé das páginas de conteúdo ────────────────────────────────────────────

def _draw_footer(c, page_num: int, total_pages: int):
    W = PW
    _fill(c, "bgPage")
    c.rect(0, 0, W, 10 * mm, fill=1, stroke=0)
    _stroke(c, "cinzaLinha")
    c.setLineWidth(0.3)
    c.line(10 * mm, 10 * mm, W - 10 * mm, 10 * mm)
    _fill(c, "cinzaMuted")
    c.setFont("Helvetica", 7)
    c.drawString(10 * mm, 4 * mm, "ELLA OS  ·  Sankhya Experience")
    c.drawRightString(W - 10 * mm, 4 * mm, f"Página {page_num} de {total_pages}")


# ── Título de seção ────────────────────────────────────────────────────────────

def _draw_section_title(c, texto: str, y: float) -> float:
    """Desenha bloco de título de seção. Retorna novo y (abaixo do bloco)."""
    M = 10 * mm
    _fill(c, "verdeClaro")
    c.rect(M, y - 9 * mm, PW - 2 * M, 9 * mm, fill=1, stroke=0)
    _fill(c, "verde")
    c.rect(M, y - 9 * mm, 3 * mm, 9 * mm, fill=1, stroke=0)
    _spaced_color(c, texto, M + 7 * mm, y - 6 * mm,
                  "Helvetica-Bold", 7.5, "verdeEscuro", space_pt=1)
    return y - 9 * mm - 5 * mm


# ── Tabela de apontamentos ─────────────────────────────────────────────────────

# Dimensões das colunas (em pontos)
_M       = 10 * mm
_LRG     = PW - 2 * _M
_C_DATA  = 20 * mm
_C_INI   = 16 * mm
_C_FIM   = 16 * mm
_C_EXEC  = 18 * mm
_C_TAR   = _LRG - _C_DATA - _C_INI - _C_FIM - _C_EXEC
_HDR_H   = 9  * mm
_ROW_FS  = 7.5
_ROD_H   = 16 * mm    # espaço reservado no fundo para barra total + rodapé


def _row_height(ap: dict) -> float:
    tarefa = str(ap.get("tarefa") or "–")
    lns = simpleSplit(tarefa, "Helvetica", _ROW_FS, _C_TAR - 4 * mm)
    return max(8 * mm, len(lns) * 4.0 * mm + 4 * mm)


def _count_content_pages(apontamentos: list[dict]) -> int:
    """Calcula quantas páginas de conteúdo serão necessárias."""
    if not apontamentos:
        return 1
    pages = 1
    # Primeira página: header(16mm gap → y=PH-24mm) + título seção(14mm) + cabeçalho tabela(9mm)
    y = PH - 24 * mm - (9 * mm + 5 * mm) - _HDR_H   # PH - 47mm
    for ap in apontamentos:
        rh = _row_height(ap)
        if y - rh < _ROD_H:
            pages += 1
            # Páginas seguintes: header(→ y=PH-24mm) + cabeçalho tabela(9mm) = PH-33mm
            y = PH - 24 * mm - _HDR_H
        y -= rh
    return pages


def _draw_table_header(c, y: float) -> float:
    _fill(c, "verde")
    c.rect(_M, y - _HDR_H, _LRG, _HDR_H, fill=1, stroke=0)
    _fill(c, "branco")
    c.setFont("Helvetica-Bold", 7)
    x = _M + 3 * mm
    for lbl, col_w in [("DATA", _C_DATA), ("TAREFA", _C_TAR),
                        ("INÍCIO", _C_INI), ("FIM", _C_FIM), ("EXEC.", _C_EXEC)]:
        c.drawString(x + 2 * mm, y - _HDR_H + 6 * mm, lbl)
        x += col_w
    return y - _HDR_H


def _draw_table(c, apontamentos: list[dict],
                start_y: float, nome_cliente: str,
                periodo_str: str, total_pages: int,
                page_ref: list) -> float:
    """
    Desenha tabela com quebras de página automáticas.
    page_ref[0] = número da página atual (mutável).
    Retorna y final (posição abaixo da última linha).
    """
    y = _draw_table_header(c, start_y)

    def nova_pagina():
        nonlocal y
        _draw_footer(c, page_ref[0], total_pages)
        c.showPage()
        page_ref[0] += 1
        _draw_header(c, nome_cliente, periodo_str)
        y = PH - 24 * mm
        y = _draw_table_header(c, y)

    for i, ap in enumerate(apontamentos):
        tarefa  = str(ap.get("tarefa") or "–")
        lns_tar = simpleSplit(tarefa, "Helvetica", _ROW_FS, _C_TAR - 4 * mm)
        rh      = max(8 * mm, len(lns_tar) * 4.0 * mm + 4 * mm)

        if y - rh < _ROD_H:
            nova_pagina()

        # Fundo alternado
        if i % 2 == 1:
            _fill(c, "linhaAlt")
            c.rect(_M, y - rh, _LRG, rh, fill=1, stroke=0)

        # Linha separadora
        _stroke(c, "cinzaLinha")
        c.setLineWidth(0.15)
        c.line(_M, y - rh, _M + _LRG, y - rh)

        cy = y - 5 * mm
        cx = _M + 3 * mm

        # DATA
        _fill(c, "cinzaTexto")
        c.setFont("Helvetica", _ROW_FS)
        c.drawString(cx, cy, _fmt_date(str(ap.get("data_os") or "")))
        cx += _C_DATA

        # TAREFA (multi-linha)
        _fill(c, "preto")
        c.setFont("Helvetica", _ROW_FS)
        for j, ln in enumerate(lns_tar):
            c.drawString(cx + 2 * mm, cy - j * 4.0 * mm, ln)
        cx += _C_TAR

        # INÍCIO
        _fill(c, "cinzaTexto")
        c.setFont("Helvetica", _ROW_FS)
        c.drawString(cx + 2 * mm, cy, _fmt_time(ap.get("hora_inicio")))
        cx += _C_INI

        # FIM
        c.drawString(cx + 2 * mm, cy, _fmt_time(ap.get("hora_fim")))
        cx += _C_FIM

        # EXEC. (decimal)
        _fill(c, "verde")
        c.setFont("Helvetica-Bold", _ROW_FS)
        exec_val = float(ap.get("horas_executadas") or 0)
        c.drawString(cx + 2 * mm, cy, f"{exec_val:.2f}")

        y -= rh

    return y


# ── Barra de total ─────────────────────────────────────────────────────────────

def _draw_total_bar(c, total_os: int, total_dec: float, y: float):
    bar_h = 11 * mm
    _fill(c, "bgCapaDark")
    c.roundRect(_M, y - bar_h, _LRG, bar_h, 2 * mm, fill=1, stroke=0)
    _fill(c, "verde")
    c.roundRect(_M, y - bar_h, 4 * mm, bar_h, 1 * mm, fill=1, stroke=0)

    suffix = "s" if total_os != 1 else ""
    _fill(c, "branco")
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(_M + 8 * mm, y - 7.5 * mm,
                 f"TOTAL  ·  {total_os} atividade{suffix}")

    _fill(c, "verdeMuted")
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(PW - _M - 5 * mm, y - 7.5 * mm,
                      _fmt_horas_kpi(total_dec) + " h")


# ── Função pública ─────────────────────────────────────────────────────────────

def gerar_status_report(
    nome_empresa:    str,
    nome_cliente:    str,
    periodo_inicio:  str,
    periodo_fim:     str,
    apontamentos:    list[dict],
    cabecalho:       Optional[str] = None,
    rodape:          Optional[str] = None,
) -> Optional[bytes]:
    """
    Gera um PDF de Status Report em landscape A4 com layout fiel ao exportPDF.ts.
    Retorna None se reportlab não estiver instalado.
    """
    if not _REPORTLAB_OK:
        return None

    periodo_str = _periodo_fmt(periodo_inicio, periodo_fim)
    total_dec   = sum(float(a.get("horas_executadas") or 0) for a in apontamentos)
    media_dec   = total_dec / len(apontamentos) if apontamentos else 0.0
    total_os    = len(apontamentos)

    # Pré-calcula o total de páginas para numeração correta
    n_content = _count_content_pages(apontamentos)
    total_pages = 1 + n_content    # capa + páginas de conteúdo

    buffer = io.BytesIO()
    c = rl_canvas.Canvas(buffer, pagesize=landscape(A4))
    c.setTitle(f"Status Report — {nome_cliente}")
    c.setAuthor(nome_empresa)

    # ── Página 1: Capa ─────────────────────────────────────────────────────────
    _draw_cover(c, nome_cliente, periodo_str, total_os, total_dec, media_dec)

    # ── Páginas de conteúdo ────────────────────────────────────────────────────
    c.showPage()
    page_ref = [2]    # página atual (mutável via lista)
    _draw_header(c, nome_cliente, periodo_str)

    y = PH - 24 * mm
    y = _draw_section_title(c, "ATIVIDADES REALIZADAS NO PERÍODO", y)

    if not apontamentos:
        _fill(c, "preto")
        c.setFont("Helvetica", 9)
        c.drawString(10 * mm, y, "Nenhuma OS registrada no período.")
        y -= 10 * mm
    else:
        y = _draw_table(c, apontamentos, y, nome_cliente,
                        periodo_str, total_pages, page_ref)

    # Barra de total
    y_bar = y - 5 * mm
    bar_h = 11 * mm
    if y_bar - bar_h < _ROD_H:
        _draw_footer(c, page_ref[0], total_pages)
        c.showPage()
        page_ref[0] += 1
        _draw_header(c, nome_cliente, periodo_str)
        y_bar = PH - 24 * mm

    _draw_total_bar(c, total_os, total_dec, y_bar)

    # Rodapé da última página
    _draw_footer(c, page_ref[0], total_pages)

    try:
        c.save()
        return buffer.getvalue()
    except Exception:
        logger.exception("pdf_generator: erro ao salvar PDF.")
        return None
