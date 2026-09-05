# -*- coding: utf-8 -*-
"""
Módulo de apontamento automático de OS via tela de Tarefas do Sankhya Experience.

Fluxo por OS:
  1. Navegar até url_tarefas do cliente (com autenticação automática)
  2. Aplicar filtros: Usuário = executante, Data Agendamento = data_os
  3. Identificar a linha da tarefa pelo ticket na coluna Observações
  4. Selecionar o checkbox da tarefa
  5. Clicar em "Gerar OS"
  6. Preencher formulário: data, hora início, hora fim, intervalo, observação
  7. Salvar e fechar o dialog de confirmação
"""
from __future__ import annotations

import os
import tempfile
import time
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

from core.automacao.sankhya import (
    DEBUG_DIR,
    RPAConfig,
    _build_config,
    _capturar_feedback_tela,
    _click_first_visible,
    _digitar_humanizado,
    _digitar_locator,
    _esta_visivel,
    _executar_login,
    _fechar_swal_se_visivel,
    _first_visible_locator,
    _habilitar_webauthn_virtual,
    _log_os,
    _navegar_sankhya,
    _pagina_pede_login,
    normalizar,
    normalizar_data_experience,
    normalizar_hora,
)

# ── Seletores da tela de Tarefas ──────────────────────────────────────────────
_TAREFAS_INDICADORES = (
    "button:has-text('Filtrar')",
    "button:has-text('Gerar OS')",
    ".p-datatable-tbody",
    ".p-datatable",
)

# Filtro de usuário na tela de Tarefas
_FILTRO_USUARIO_SELECTORS = (
    "div[data-pc-name='dropdown']:has(input[id*='user']), div[data-pc-name='dropdown']:has(input[id*='usuario'])",
    ".p-dropdown:has(.p-dropdown-label)",
)

# Seletores do formulário de apontamento que aparece após "Gerar OS"
_FORM_DATA = "input[aria-controls='calendarId_panel']"
_FORM_HORA_INICIO = "#startHour"
_FORM_HORA_FIM = "#finishHour"
_FORM_INTERVALO = "#intervalHour"
_FORM_OBS = "#textarea, textarea.form-control[maxlength='4000']"
_FORM_SALVAR = "#salvar-button"
_GERAR_OS_BTN = "button:has-text('Gerar OS')"
_FILTRAR_BTN = "button:has-text('Filtrar')"


# ── Aguardar tela de Tarefas ──────────────────────────────────────────────────

def _aguardar_tela_tarefas(page, timeout_ms: int) -> None:
    """Espera a tela de Tarefas carregar detectando elementos chave."""
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        if _pagina_pede_login(page):
            raise RuntimeError(
                f"Tela de Tarefas solicitou login. URL atual: {getattr(page, 'url', '?')}"
            )
        for selector in _TAREFAS_INDICADORES:
            loc = page.locator(selector).first
            try:
                if loc.count() > 0 and loc.is_visible():
                    return
            except Exception:
                continue
        page.wait_for_timeout(250)
    raise RuntimeError(
        f"Tela de Tarefas não ficou disponível após {timeout_ms}ms. "
        f"URL atual: {getattr(page, 'url', '?')}"
    )


# ── Sessão na tela de Tarefas ────────────────────────────────────────────────

def _garantir_sessao_tarefas(page, url_tarefas: str, exp_usuario: str | None, exp_senha: str | None, config: RPAConfig) -> None:
    """Navega para url_tarefas garantindo sessão autenticada."""
    print(f"Navegando para Tarefas: {url_tarefas}", flush=True)
    _navegar_sankhya(page, url_tarefas, config.timeout_ms, "tarefas inicial")

    try:
        _aguardar_tela_tarefas(page, min(config.timeout_ms, 15000))
        print("Tela de Tarefas carregada sem necessidade de login.", flush=True)
        return
    except Exception as e_load:
        print(f"Tela de Tarefas não carregou diretamente: {e_load}", flush=True)

    # Tentar login
    for tentativa in range(1, 3):
        if tentativa > 1:
            print(f"Nova tentativa de login para Tarefas ({tentativa}/2).", flush=True)
            _navegar_sankhya(page, url_tarefas, config.timeout_ms, f"tarefas tentativa {tentativa}")
            try:
                _aguardar_tela_tarefas(page, min(config.timeout_ms, 10000))
                return
            except Exception:
                pass

        try:
            _executar_login(page, exp_usuario, exp_senha, config.timeout_ms)
            print("Login concluído. Retornando para Tarefas.", flush=True)
            _navegar_sankhya(page, url_tarefas, config.timeout_ms, "tarefas pós-login")
            _aguardar_tela_tarefas(page, config.timeout_ms)
            return
        except Exception as e_login:
            print(f"Falha no login ({tentativa}/2): {e_login}", flush=True)
            if tentativa == 2:
                raise RuntimeError(
                    f"Não foi possível autenticar para acessar Tarefas: {e_login}"
                ) from e_login


# ── Filtrar tarefas por usuário e data ────────────────────────────────────────

def _aplicar_filtros_tarefas(page, executante: str, data_os: str, timeout_ms: int) -> None:
    """
    Aplica os filtros de Usuário e Data Agendamento na tela de Tarefas
    e clica em Filtrar.
    """
    data_fmt = normalizar_data_experience(data_os)
    print(f"Aplicando filtros: usuário={executante}, data={data_fmt}", flush=True)

    # ── Filtro de Data Agendamento ──────────────────────────────────────────
    # O campo de data é um input com role=combobox ou aria-controls=calendarId_panel
    data_selectors = (
        "input[aria-controls='calendarId_panel']",
        "input[placeholder*='Data']",
        "input[id*='data']",
        "input[id*='date']",
    )
    campo_data = _first_visible_locator(page, data_selectors, min(timeout_ms, 5000))
    if campo_data:
        try:
            campo_data.click(force=True)
            page.wait_for_timeout(300)
            campo_data.press("Control+A")
            campo_data.press("Backspace")
            page.wait_for_timeout(200)
            campo_data.fill(data_fmt)
            page.wait_for_timeout(300)
            # Fechar o calendário pressionando Escape ou Tab
            campo_data.press("Escape")
            page.wait_for_timeout(200)
            print(f"Data filtro preenchida: {data_fmt}", flush=True)
        except Exception as e_data:
            print(f"Aviso: não foi possível preencher filtro de data: {e_data}", flush=True)

    # ── Filtro de Usuário ───────────────────────────────────────────────────
    # A tela tem um dropdown de Usuário — tenta encontrar e selecionar pelo texto
    usuario_selectors = (
        "div.p-dropdown:has(input[placeholder*='Usuário']), div.p-dropdown:has(input[placeholder*='Usuario'])",
        "div[data-pc-name='dropdown']",
    )
    campo_usuario = None
    for sel in usuario_selectors:
        locs = page.locator(sel).all()
        if locs:
            # Usar o último dropdown visível (Usuário costuma ser o último filtro)
            for loc in reversed(locs):
                try:
                    if loc.is_visible():
                        campo_usuario = loc
                        break
                except Exception:
                    continue
        if campo_usuario:
            break

    if campo_usuario:
        try:
            campo_usuario.click()
            page.wait_for_timeout(400)
            # Procurar o usuário nas opções
            opcoes = page.locator("li[role='option']:visible, .p-dropdown-item:visible")
            count = opcoes.count()
            for i in range(count):
                opt = opcoes.nth(i)
                try:
                    texto = normalizar(opt.inner_text(timeout=1000))
                    if normalizar(executante) in texto or texto in normalizar(executante):
                        opt.click()
                        print(f"Usuário selecionado no filtro: {executante}", flush=True)
                        break
                except Exception:
                    continue
            else:
                print(f"Aviso: usuário '{executante}' não encontrado no dropdown de filtro.", flush=True)
                page.keyboard.press("Escape")
        except Exception as e_usr:
            print(f"Aviso: não foi possível aplicar filtro de usuário: {e_usr}", flush=True)

    # ── Clicar em Filtrar ───────────────────────────────────────────────────
    page.wait_for_timeout(300)
    clicou = _click_first_visible(page, (_FILTRAR_BTN,), min(timeout_ms, 5000))
    if clicou:
        print("Botão Filtrar clicado.", flush=True)
        page.wait_for_timeout(1500)  # Aguardar resultado do filtro
    else:
        print("Aviso: botão Filtrar não encontrado — prosseguindo sem filtrar.", flush=True)


# ── Encontrar a linha da tarefa pelo ticket ───────────────────────────────────

def _encontrar_linha_tarefa(page, ticket: str, timeout_ms: int):
    """
    Varre as linhas da tabela de Tarefas procurando a que contém o ticket
    na coluna Observações. Retorna o locator da linha ou None.
    """
    if not ticket:
        # Sem ticket: retornar a primeira linha disponível
        linha = page.locator(".p-datatable-tbody > tr, table tbody tr").first
        try:
            if linha.count() > 0 and linha.is_visible():
                print("Ticket não informado — usando primeira linha da tabela.", flush=True)
                return linha
        except Exception:
            pass
        return None

    ticket_norm = normalizar(ticket)
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        linhas = page.locator(".p-datatable-tbody > tr, table tbody tr").all()
        if linhas:
            for linha in linhas:
                try:
                    texto_linha = normalizar(linha.inner_text(timeout=2000))
                    if ticket_norm in texto_linha:
                        print(f"Tarefa encontrada para ticket '{ticket}'.", flush=True)
                        return linha
                except Exception:
                    continue
            # Nenhuma linha contém o ticket — talvez a tabela ainda esteja carregando
            # Se há linhas mas nenhuma bate, retornar None imediatamente
            if linhas:
                print(
                    f"Nenhuma linha contém o ticket '{ticket}'. "
                    f"Total de linhas visíveis: {len(linhas)}.",
                    flush=True,
                )
                return None
        page.wait_for_timeout(250)

    print(f"Timeout aguardando linhas da tabela para ticket '{ticket}'.", flush=True)
    return None


# ── Selecionar checkbox e clicar Gerar OS ────────────────────────────────────

def _selecionar_e_gerar_os(page, linha, apontamento: dict, timeout_ms: int) -> None:
    """Seleciona o checkbox da linha e clica em Gerar OS."""
    # Clicar no checkbox da linha
    checkbox = linha.locator(".p-checkbox-input, input[type='checkbox']").first
    try:
        checkbox.wait_for(state="visible", timeout=5000)
        # Verifica se já está marcado
        ja_marcado = checkbox.is_checked()
        if not ja_marcado:
            checkbox.click(force=True)
            page.wait_for_timeout(400)
            print("Checkbox da tarefa selecionado.", flush=True)
        else:
            print("Checkbox já estava selecionado.", flush=True)
    except Exception as e_cb:
        # Fallback: clicar na linha para selecionar
        print(f"Aviso: clique no checkbox falhou ({e_cb}) — clicando na linha.", flush=True)
        try:
            linha.click()
            page.wait_for_timeout(400)
        except Exception:
            pass

    # Clicar em Gerar OS
    _log_os(apontamento, "Clicando em Gerar OS.")
    gerou = _click_first_visible(page, (_GERAR_OS_BTN,), min(timeout_ms, 8000))
    if not gerou:
        raise RuntimeError("Botão 'Gerar OS' não encontrado após selecionar a tarefa.")
    print("Botão Gerar OS clicado.", flush=True)
    page.wait_for_timeout(800)


# ── Aguardar e preencher formulário de apontamento ───────────────────────────

def _aguardar_formulario_apontamento(page, timeout_ms: int) -> None:
    """Aguarda os campos do formulário de apontamento aparecerem."""
    FORM_INDICADORES = (
        _FORM_HORA_INICIO,
        _FORM_HORA_FIM,
        _FORM_DATA,
    )
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        for sel in FORM_INDICADORES:
            loc = page.locator(sel).first
            try:
                if loc.count() > 0 and loc.is_visible():
                    return
            except Exception:
                continue
        page.wait_for_timeout(250)
    raise RuntimeError("Formulário de apontamento não apareceu após 'Gerar OS'.")


def _preencher_formulario_apontamento(page, apontamento: dict, timeout_ms: int) -> None:
    """Preenche os campos do formulário de apontamento."""
    data_fmt = normalizar_data_experience(apontamento.get("data_os", ""))
    hora_inicio = normalizar_hora(apontamento.get("hora_inicio", ""))
    hora_fim = normalizar_hora(apontamento.get("hora_fim", ""))
    ticket = str(apontamento.get("ticket") or "")
    tarefa = str(apontamento.get("tarefa") or "")[:450]

    _log_os(apontamento, f"Preenchendo formulário: data={data_fmt}, {hora_inicio}–{hora_fim}")

    # ── Data ──────────────────────────────────────────────────────────────
    campo_data = page.locator(_FORM_DATA).first
    try:
        campo_data.wait_for(state="visible", timeout=min(timeout_ms, 5000))
        campo_data.click(force=True)
        page.wait_for_timeout(200)
        campo_data.press("Control+A")
        campo_data.press("Backspace")
        page.wait_for_timeout(100)
        campo_data.fill(data_fmt)
        page.wait_for_timeout(300)
        # Fechar calendário se aberto
        try:
            page.locator("[aria-controls='calendarId_panel']").first.press("Escape")
        except Exception:
            pass
    except Exception as e_data:
        _log_os(apontamento, f"Aviso: não foi possível preencher data: {e_data}")

    # ── Hora início ───────────────────────────────────────────────────────
    campo_hi = page.locator(_FORM_HORA_INICIO).first
    try:
        campo_hi.wait_for(state="visible", timeout=min(timeout_ms, 5000))
        _digitar_locator(campo_hi, hora_inicio, "hora_inicio")
    except Exception as e_hi:
        _log_os(apontamento, f"Aviso: hora início falhou: {e_hi}")

    # ── Hora fim ──────────────────────────────────────────────────────────
    campo_hf = page.locator(_FORM_HORA_FIM).first
    try:
        campo_hf.wait_for(state="visible", timeout=min(timeout_ms, 5000))
        _digitar_locator(campo_hf, hora_fim, "hora_fim")
    except Exception as e_hf:
        _log_os(apontamento, f"Aviso: hora fim falhou: {e_hf}")

    # ── Intervalo (00:00) ─────────────────────────────────────────────────
    campo_int = page.locator(_FORM_INTERVALO).first
    try:
        if campo_int.count() > 0 and campo_int.is_visible():
            _digitar_locator(campo_int, "00:00", "intervalo")
    except Exception:
        pass

    # ── Conformidade já pré-selecionada — verificar e não alterar ─────────
    # O dropdown de Conformidade já vem com "Conformidade" selecionado.
    # Não há necessidade de interação se já estiver correto.

    # ── Observação ────────────────────────────────────────────────────────
    campo_obs = _first_visible_locator(page, (_FORM_OBS,), min(timeout_ms, 5000))
    if campo_obs:
        # Aguardar o Sankhya preencher automaticamente o conteúdo base
        page.wait_for_timeout(600)
        try:
            conteudo_atual = campo_obs.input_value() or ""
        except Exception:
            try:
                conteudo_atual = campo_obs.evaluate("el => el.value || ''")
            except Exception:
                conteudo_atual = ""

        # Se Sankhya auto-preencheu o campo, substituir apenas a linha Observações
        obs_final = _montar_observacao(conteudo_atual, ticket, tarefa)
        try:
            campo_obs.evaluate(
                """
                (el, valor) => {
                    el.focus();
                    const proto = window.HTMLTextAreaElement.prototype;
                    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
                    if (descriptor && descriptor.set) {
                        descriptor.set.call(el, valor);
                    } else {
                        el.value = valor;
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """,
                obs_final,
            )
            _log_os(apontamento, f"Observação preenchida ({len(obs_final)} chars).")
        except Exception as e_obs:
            _log_os(apontamento, f"Aviso: observação via JS falhou ({e_obs}) — usando fill.")
            try:
                campo_obs.fill(obs_final)
            except Exception:
                pass
    else:
        _log_os(apontamento, "Aviso: campo de observação não encontrado.")

    page.wait_for_timeout(300)


def _montar_observacao(conteudo_atual: str, ticket: str, tarefa: str) -> str:
    """
    Mantém a estrutura auto-gerada pelo Sankhya e substitui/acrescenta a
    linha de Observações com o ticket e a tarefa do registro ELLA.
    """
    nova_obs = f"{ticket} — {tarefa}".strip(" —") if (ticket or tarefa) else ""

    if "Observações:" in conteudo_atual:
        linhas = conteudo_atual.splitlines()
        resultado = []
        for linha in linhas:
            if linha.strip().startswith("Observações:"):
                resultado.append(f"Observações: {nova_obs}")
            else:
                resultado.append(linha)
        return "\n".join(resultado)

    # Campo vazio ou sem linha de Observações — montar do zero
    if not conteudo_atual.strip():
        return (
            "Tarefas Realizadas:\n\n"
            "\tAtendimento:\n"
            "\t\tAtendimento Avulso:\n"
            "\t\t\t- Atendimento Avulso\n\n"
            f"Observações: {nova_obs}"
        )

    # Tem conteúdo mas sem "Observações:" — appends
    return f"{conteudo_atual.rstrip()}\n\nObservações: {nova_obs}"


# ── Aguardar confirmação e fechar ─────────────────────────────────────────────

def _aguardar_apontamento_finalizado(page, apontamento: dict, timeout_ms: int) -> None:
    """
    Aguarda o formulário fechar após salvar.
    Fecha qualquer swal2 que apareça.
    """
    deadline = time.monotonic() + (timeout_ms / 1000)
    fechamentos = 0
    while time.monotonic() < deadline:
        if _pagina_pede_login(page):
            raise RuntimeError("Sessão voltou para login durante apontamento.")

        if fechamentos < 10 and _fechar_swal_se_visivel(page, apontamento):
            fechamentos += 1
            continue

        # Considera concluído quando o formulário sumiu (campos não visíveis)
        formulario_aberto = any(
            _esta_visivel(page, sel)
            for sel in (_FORM_HORA_INICIO, _FORM_HORA_FIM, _FORM_SALVAR)
        )
        if not formulario_aberto:
            _log_os(apontamento, "Formulário de apontamento fechado.")
            return

        page.wait_for_timeout(250)

    detalhe = _capturar_feedback_tela(page)
    raise RuntimeError(
        "Apontamento não confirmou fechamento do formulário."
        + (f" Feedback: {detalhe}" if detalhe else "")
    )


# ── Executar um apontamento ───────────────────────────────────────────────────

def executar_apontamento_tarefa(page, apontamento: dict, timeout_ms: int = 30000) -> tuple[bool, dict | None]:
    """
    Executa o apontamento de uma OS na tela de Tarefas.
    Retorna (sucesso, erro_info).
    """
    ticket = str(apontamento.get("ticket") or "")
    _log_os(apontamento, f"Iniciando apontamento (ticket={ticket or '—'}).")

    # Aguardar a tela de tarefas estar pronta
    _aguardar_tela_tarefas(page, timeout_ms)

    # Aplicar filtros para encontrar a tarefa
    _aplicar_filtros_tarefas(
        page,
        apontamento.get("executante", ""),
        apontamento.get("data_os", ""),
        timeout_ms,
    )

    # Encontrar a linha da tarefa
    linha = _encontrar_linha_tarefa(page, ticket, min(timeout_ms, 10000))
    if linha is None:
        motivo = (
            f"Tarefa não encontrada para ticket '{ticket}', "
            f"executante '{apontamento.get('executante')}', "
            f"data '{apontamento.get('data_os')}'."
        )
        _log_os(apontamento, f"FALHA: {motivo}")
        return False, {**apontamento, "motivo": motivo}

    # Selecionar checkbox e clicar Gerar OS
    try:
        _selecionar_e_gerar_os(page, linha, apontamento, timeout_ms)
    except Exception as e_gerar:
        motivo = f"Falha ao clicar em Gerar OS: {e_gerar}"
        _log_os(apontamento, f"FALHA: {motivo}")
        return False, {**apontamento, "motivo": motivo}

    # Aguardar formulário abrir
    try:
        _aguardar_formulario_apontamento(page, timeout_ms)
    except Exception as e_form:
        motivo = f"Formulário de apontamento não abriu: {e_form}"
        _log_os(apontamento, f"FALHA: {motivo}")
        return False, {**apontamento, "motivo": motivo}

    # Preencher formulário
    _preencher_formulario_apontamento(page, apontamento, timeout_ms)

    # Salvar
    _log_os(apontamento, "Clicando em Salvar.")
    salvou = _click_first_visible(page, (_FORM_SALVAR,), min(timeout_ms, 5000))
    if not salvou:
        motivo = "Botão Salvar não encontrado no formulário de apontamento."
        _log_os(apontamento, f"FALHA: {motivo}")
        return False, {**apontamento, "motivo": motivo}

    # Aguardar confirmação e fechar dialog
    _aguardar_apontamento_finalizado(page, apontamento, timeout_ms)

    _log_os(apontamento, "Apontamento concluído com sucesso.")
    return True, None


# ── Fluxo completo ────────────────────────────────────────────────────────────

def executar_fluxo_apontamento(lista_apontamentos: list[dict], config: dict | None = None) -> dict:
    """
    Executa o apontamento automático para uma lista de OS.
    Agrupa por cliente e reutiliza a sessão do browser.
    """
    rpa_config = _build_config(config)

    print("\n==================================================", flush=True)
    print("INICIANDO FLUXO DE APONTAMENTO AUTOMÁTICO", flush=True)
    print("==================================================\n", flush=True)

    sucessos: list[dict] = []
    erros: list[dict] = []
    itens_pendentes = {id(a): a for a in lista_apontamentos}
    erro_critico: str | None = None
    temp_profile: tempfile.TemporaryDirectory | None = None

    try:
        # Agrupar por (cliente_id, url_tarefas) para reutilizar sessão
        grupos: dict[str, list[dict]] = defaultdict(list)
        for apt in lista_apontamentos:
            chave = apt.get("url_tarefas") or apt.get("cliente_id") or "sem_url"
            grupos[chave].append(apt)

        sem_display = (os.name != "nt") and not os.environ.get("DISPLAY")
        headless = True if sem_display else rpa_config.headless

        base_args = [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-popup-blocking",
            "--lang=pt-BR",
        ]

        user_agent = os.environ.get("RPA_USER_AGENT") or (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/139.0.0.0 Safari/537.36"
        )

        if sem_display:
            temp_profile = tempfile.TemporaryDirectory(prefix="sankhya_apt_profile_")
            user_data_dir = temp_profile.name
        else:
            user_data_dir_path = (
                Path(__file__).resolve().parents[2] / "runtime" / "sankhya_profile"
            )
            user_data_dir_path.mkdir(parents=True, exist_ok=True)
            user_data_dir = str(user_data_dir_path)

        launch_kwargs: dict = {
            "user_data_dir": user_data_dir,
            "headless": headless,
            "args": base_args,
            "ignore_default_args": ["--enable-automation"],
            "user_agent": user_agent,
            "locale": "pt-BR",
            "timezone_id": "America/Sao_Paulo",
        }
        if headless:
            launch_kwargs["viewport"] = {"width": 1600, "height": 900}

        proxy_server = os.environ.get("RPA_PROXY_SERVER", "").strip()
        if proxy_server:
            launch_kwargs["proxy"] = {"server": proxy_server}

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(**launch_kwargs)
            page = context.pages[0] if context.pages else context.new_page()
            for extra in context.pages[1:]:
                try:
                    extra.close()
                except Exception:
                    pass

            page.set_default_timeout(rpa_config.timeout_ms)
            page.set_default_navigation_timeout(rpa_config.timeout_ms)

            # Patches anti-detecção (mesmos do sankhya.py)
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
                Object.defineProperty(navigator, 'language', { get: () => 'pt-BR' });
                window.chrome = { runtime: { connect: () => ({}), sendMessage: () => {} } };
            """)

            _habilitar_webauthn_virtual(context, page)

            for chave_cliente, lista_cliente in grupos.items():
                primeiro = lista_cliente[0]
                url_tarefas = primeiro.get("url_tarefas") or ""
                exp_usuario = primeiro.get("exp_usuario")
                exp_senha = primeiro.get("exp_senha")

                if not url_tarefas:
                    motivo = f"url_tarefas não configurada para o cliente '{primeiro.get('cliente_nome', chave_cliente)}'."
                    print(f"FALHA (cliente {chave_cliente}): {motivo}", flush=True)
                    for apt in lista_cliente:
                        erros.append({**apt, "motivo": motivo})
                        itens_pendentes.pop(id(apt), None)
                    continue

                print(f"\nProcessando cliente: {primeiro.get('cliente_nome', chave_cliente)}", flush=True)

                try:
                    _garantir_sessao_tarefas(page, url_tarefas, exp_usuario, exp_senha, rpa_config)
                except Exception as e_nav:
                    print(f"Falha ao acessar Tarefas do cliente {chave_cliente}: {e_nav}", flush=True)
                    for apt in lista_cliente:
                        erros.append({**apt, "motivo": f"Falha ao acessar Tarefas: {e_nav}"})
                        itens_pendentes.pop(id(apt), None)
                    continue

                for apt in lista_cliente:
                    erro_info = None
                    apontado = False

                    for tentativa in range(1, rpa_config.tentativas + 1):
                        try:
                            sucesso, erro_info = executar_apontamento_tarefa(
                                page, apt, timeout_ms=rpa_config.timeout_ms
                            )
                            if sucesso:
                                apontado = True
                                sucessos.append(apt)
                                itens_pendentes.pop(id(apt), None)
                                print(
                                    f"SUCESSO apontamento | ticket={apt.get('ticket')} "
                                    f"| {apt.get('executante')}",
                                    flush=True,
                                )
                                break
                        except Exception as exc:
                            traceback.print_exc()
                            erro_info = {**apt, "motivo": f"Erro inesperado: {exc}"}

                        if tentativa < rpa_config.tentativas:
                            print(f"Retentando apontamento ({tentativa}/{rpa_config.tentativas}).", flush=True)
                            try:
                                _garantir_sessao_tarefas(page, url_tarefas, exp_usuario, exp_senha, rpa_config)
                            except Exception:
                                break
                            if rpa_config.delay_entre_os_ms:
                                page.wait_for_timeout(rpa_config.delay_entre_os_ms)

                    if not apontado:
                        erros.append(erro_info or {**apt, "motivo": "Falha sem detalhe."})
                        itens_pendentes.pop(id(apt), None)
                        print(
                            f"FALHA apontamento | ticket={apt.get('ticket')} "
                            f"| {apt.get('executante')}",
                            flush=True,
                        )

                    if rpa_config.delay_entre_os_ms:
                        page.wait_for_timeout(rpa_config.delay_entre_os_ms)

            context.close()

    except PlaywrightTimeout as exc:
        erro_critico = f"Timeout na automação de apontamento: {exc}"
        print(erro_critico, flush=True)
    except Exception as exc:
        erro_critico = f"ERRO CRÍTICO no apontamento: {exc}"
        print(erro_critico, flush=True)
        traceback.print_exc()
    finally:
        if erro_critico:
            for apt in list(itens_pendentes.values()):
                erros.append({**apt, "motivo": erro_critico})

        print(f"\nApontamento finalizado. Sucesso: {len(sucessos)} | Falha: {len(erros)}\n", flush=True)

        if temp_profile is not None:
            try:
                temp_profile.cleanup()
            except Exception:
                pass

    return {"sucesso": sucessos, "falha": erros}
