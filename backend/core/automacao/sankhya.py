# -*- coding: utf-8 -*-
from __future__ import annotations

import difflib
import os
import re

import time
import traceback
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

GESTAO_SELECTORS = (
    "button:has-text('Novo')",
    "span.checkbox-activity",
    "div.process-check:has-text('Atendimento Avulso')",
)
# Botões de fechamento/confirmação do SweetAlert2 (swal2) que o Sankhya usa após salvar OS.
# Listados do mais específico para o mais genérico — a ordem importa.
SWAL_FECHAR_SELECTORS = (
    "button.swal2-confirm.confirm-button-styled",
    "button.swal2-confirm",
    "button.confirm-button-styled",
    "button.swal2-styled",
    ".swal2-popup button:has-text('Fechar')",
    ".swal2-popup button:has-text('OK')",
    ".swal2-popup button:has-text('Ok')",
    ".swal2-popup button:has-text('Confirmar')",
    ".swal2-actions button",
)
USER_SELECTORS = (
    "#user",
    "input[name='user']",
    "input[autocomplete='user']",
    "input[name='username']",
    "input[name='email']",
    "input[type='email']",
    "input[autocomplete='username']",
    "input[id*='user']",
    "input[name*='user']",
    "input[id*='login']",
    "input[name*='login']",
)
PASSWORD_SELECTORS = (
    "#password",
    "input[type='password']",
    "input[name='password']",
    "input[id*='pass']",
    "input[name*='pass']",
    "input[autocomplete='current-password']",
)
NEXT_SELECTORS = (
    "button:has-text('Prosseguir')",
    "button.account-btn",
    "button:has-text('Continuar')",
    "button:has-text('Avancar')",
    "button:has-text('Proximo')",
)
SUBMIT_SELECTORS = (
    "button:has-text('Prosseguir')",
    "button:has-text('Entrar')",
    "button:has-text('Acessar')",
    "button:has-text('Login')",
    "button:has-text('Continuar')",
    "button.account-btn",
    "button[type='submit']",
    "input[type='submit']",
)


DEBUG_DIR = Path(__file__).resolve().parents[2] / "runtime" / "debug_rpa"


@dataclass(frozen=True)
class RPAConfig:
    headless: bool = True
    timeout_ms: int = 30000
    tentativas: int = 2
    delay_entre_os_ms: int = 800
    debug_video: bool = False
    debug_trace: bool = False


def _build_config(raw: dict | None) -> RPAConfig:
    raw = raw or {}
    timeout_ms = int(raw.get("rpa_timeout_ms") or 30000)
    tentativas = max(int(raw.get("rpa_tentativas") or 2), 1)
    delay_ms = max(int(raw.get("rpa_delay_entre_os_ms") or 800), 0)
    headless_raw = raw.get("rpa_headless")
    headless = True if headless_raw is None else bool(headless_raw)
    debug_video = bool(raw.get("rpa_debug_video") or False)
    debug_trace = bool(raw.get("rpa_debug_trace") or False)
    return RPAConfig(
        headless=headless,
        timeout_ms=max(timeout_ms, 5000),
        tentativas=tentativas,
        delay_entre_os_ms=delay_ms,
        debug_video=debug_video,
        debug_trace=debug_trace,
    )


def normalizar(texto: str | None) -> str:
    if not texto:
        return ""
    texto = unicodedata.normalize("NFD", str(texto))
    texto = texto.encode("ascii", "ignore").decode("utf-8")
    return texto.lower().strip()


def normalizar_hora(hora: str | None) -> str:
    if not hora:
        return ""
    hora = str(hora).strip()
    partes = hora.split(":")
    if len(partes) >= 2:
        return f"{partes[0].zfill(2)}:{partes[1].zfill(2)}"
    return hora


def normalizar_data_experience(data: str | None) -> str:
    if not data:
        return ""

    texto = str(data).strip()
    if not texto:
        return ""

    iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$", texto)
    if iso_match:
        ano, mes, dia = iso_match.groups()
        return f"{dia}/{mes}/{ano}"

    barra_match = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", texto)
    if barra_match:
        return texto

    hifen_match = re.match(r"^(\d{2})-(\d{2})-(\d{4})$", texto)
    if hifen_match:
        dia, mes, ano = hifen_match.groups()
        return f"{dia}/{mes}/{ano}"

    slash_iso_match = re.match(r"^(\d{4})/(\d{2})/(\d{2})$", texto)
    if slash_iso_match:
        ano, mes, dia = slash_iso_match.groups()
        return f"{dia}/{mes}/{ano}"

    return texto


def _hhmm_para_minutos(texto: str | None) -> int | None:
    """Converte 'HH:MM' em minutos totais. HH pode passar de 24 (ex.: '115:37').
    Aceita saldo negativo ('-5:00'). Retorna None se nao for parseavel."""
    if not texto:
        return None
    m = re.match(r"^\s*(-?)(\d{1,4}):(\d{2})\s*$", str(texto))
    if not m:
        return None
    sinal = -1 if m.group(1) == "-" else 1
    return sinal * (int(m.group(2)) * 60 + int(m.group(3)))


def _minutos_para_hhmm(minutos: int) -> str:
    sinal = "-" if minutos < 0 else ""
    minutos = abs(minutos)
    return f"{sinal}{minutos // 60:02d}:{minutos % 60:02d}"


def _duracao_os_minutos(os_data: dict) -> int | None:
    """Horas que a OS consome = hora_fim - hora_inicio, em minutos."""
    inicio = _hhmm_para_minutos(normalizar_hora(os_data.get("hora_inicio")))
    fim = _hhmm_para_minutos(normalizar_hora(os_data.get("hora_fim")))
    if inicio is None or fim is None:
        return None
    return fim - inicio


def _saldo_pedido_minutos(aria_label: str | None) -> int | None:
    """Extrai o saldo do pedido a partir do aria-label da opcao do dropdown.
    Ex.: 'Codigo: 5648432 / Saldo: 115:37 / Tipo: ...' -> 6937 minutos."""
    m = re.search(r"[Ss]aldo:\s*(-?\d{1,4}:\d{2})", aria_label or "")
    if not m:
        return None
    return _hhmm_para_minutos(m.group(1))


def _resumir_candidatos_usuario(candidatos: list[tuple[int, str]]) -> str:
    if not candidatos:
        return "nenhum candidato legivel"

    melhores = sorted(candidatos, key=lambda item: (-item[0], item[1]))[:5]
    return " | ".join(f"{texto} (score {score})" for score, texto in melhores)


def _wait_for_any(page, selectors: tuple[str, ...], timeout_ms: int, message: str) -> str:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        for selector in selectors:
            locator = page.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible():
                    return selector
            except Exception:
                continue
        page.wait_for_timeout(250)
    raise RuntimeError(message)


def _navegar_sankhya(page, url: str, timeout_ms: int, etapa: str) -> None:
    nav_timeout = max(timeout_ms, 60000)
    try:
        page.goto(url, wait_until="commit", timeout=nav_timeout)
        print(
            f"Navegacao iniciada ({etapa}). URL atual: {getattr(page, 'url', '?')}",
            flush=True,
        )
    except PlaywrightTimeout:
        url_atual = getattr(page, "url", "") or ""
        print(
            f"Timeout ao iniciar navegacao ({etapa}) apos {nav_timeout}ms. URL atual: {url_atual or '?'}",
            flush=True,
        )
        if url_atual and url_atual != "about:blank":
            print("Prosseguindo com pagina parcialmente carregada.", flush=True)
            return
        raise

    try:
        page.wait_for_load_state("domcontentloaded", timeout=5000)
        print(f"DOM carregado ({etapa}). URL atual: {getattr(page, 'url', '?')}", flush=True)
    except Exception as e_dom:
        print(
            f"DOM ainda nao estabilizou ({etapa}); seguindo por seletores. Detalhe: {e_dom}",
            flush=True,
        )


def _wait_for_gestao(page, timeout_ms: int) -> None:
    try:
        page.wait_for_load_state("domcontentloaded", timeout=min(timeout_ms, 15000))
    except Exception:
        pass

    deadline = time.monotonic() + (timeout_ms / 1000)
    ultimo_url = getattr(page, "url", "") or ""
    login_detectado_desde: float | None = None
    while time.monotonic() < deadline:
        ultimo_url = getattr(page, "url", "") or ultimo_url
        if _pagina_pede_login(page):
            login_detectado_desde = login_detectado_desde or time.monotonic()
            if time.monotonic() - login_detectado_desde >= 1.5:
                raise RuntimeError(f"Pagina solicitou login. URL atual: {ultimo_url}")
            page.wait_for_timeout(250)
            continue

        login_detectado_desde = None
        for selector in GESTAO_SELECTORS:
            locator = page.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible():
                    return
            except Exception:
                continue

        page.wait_for_timeout(250)

    raise RuntimeError(f"Tela de gestao da OS nao ficou disponivel. URL atual: {ultimo_url}")


def _pagina_pede_login(page) -> bool:
    url = normalizar(getattr(page, "url", ""))
    if any(token in url for token in ("login", "signin", "auth")):
        return True

    for selector in PASSWORD_SELECTORS + USER_SELECTORS[:3]:
        locator = page.locator(selector).first
        try:
            if locator.count() > 0 and locator.is_visible():
                return True
        except Exception:
            continue

    return False


def _first_visible_locator(page, selectors: tuple[str, ...], timeout_ms: int):
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        for selector in selectors:
            locator = page.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible():
                    return locator
            except Exception:
                continue
        page.wait_for_timeout(250)
    return None


def _click_first_visible(page, selectors: tuple[str, ...], timeout_ms: int) -> bool:
    locator = _first_visible_locator(page, selectors, timeout_ms)
    if not locator:
        return False
    locator.click()
    return True


def _valor_locator(locator) -> str:
    try:
        return locator.input_value()
    except Exception:
        try:
            return locator.evaluate("(el) => el.value || ''")
        except Exception:
            return ""


def _set_native_value(locator, value: str) -> None:
    try:
        locator.evaluate(
            """
            (el, newValue) => {
              el.focus();
              const proto = el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
              if (descriptor && descriptor.set) {
                descriptor.set.call(el, newValue);
              } else {
                el.value = newValue;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
              el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            }
            """,
            value,
        )
    except Exception:
        pass


def _digitar_locator(locator, value: str, campo: str) -> None:
    locator.wait_for(state="visible", timeout=5000)
    locator.scroll_into_view_if_needed()

    estrategias = (
        "native",
        "fill",
    )

    for estrategia in estrategias:
        try:
            locator.click(force=True)
        except Exception:
            locator.click()

        try:
            locator.press("Control+A")
            locator.press("Backspace")
        except Exception:
            pass

        if estrategia == "fill":
            try:
                locator.fill(value)
            except Exception:
                continue
        else:
            _set_native_value(locator, value)

        time.sleep(0.1)
        valor_atual = _valor_locator(locator)
        if valor_atual == value:
            print(
                f"Campo {campo} preenchido com sucesso ({len(valor_atual)} caracteres).",
                flush=True,
            )
            return

    valor_atual = _valor_locator(locator)
    raise RuntimeError(
        f"Campo {campo} nao aceitou o valor informado. Tamanho atual: {len(valor_atual)}"
    )


def _aguardar_login_concluir(page, timeout_ms: int) -> None:
    deadline = time.monotonic() + (timeout_ms / 1000)
    ultimo_url = ""
    fora_login_desde: float | None = None
    # 10s de estabilizacao: Sankhya pode redirecionar para login novamente
    # enquanto valida o token recem emitido (comportamento da SPA observado no servidor)
    estabilizacao_segundos = 10

    while time.monotonic() < deadline:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=1000)
        except Exception:
            pass

        ultimo_url = getattr(page, "url", "") or ""
        if not _pagina_pede_login(page):
            if fora_login_desde is None:
                fora_login_desde = time.monotonic()
                print(
                    f"Login saiu da tela de autenticacao. Aguardando {estabilizacao_segundos}s para validar sessao...",
                    flush=True,
                )
            elif time.monotonic() - fora_login_desde >= estabilizacao_segundos:
                print("Login estabilizado fora da tela de autenticacao.", flush=True)
                return
        else:
            if fora_login_desde is not None:
                print("Login voltou para a tela de autenticacao durante validacao da sessao.", flush=True)
            fora_login_desde = None

        page.wait_for_timeout(250)

    raise RuntimeError(f"Login nao concluiu. URL atual: {ultimo_url}")


_SANKHYA_LOGIN_URL = "https://login.sankhya.com.br/?redirect_to=https://experience.sankhya.com.br/projeto&application_id=6"


def _capturar_screenshot_login(page, etapa: str) -> None:
    """Salva screenshot em runtime/debug_rpa/login_errors/ para diagnostico remoto."""
    try:
        pasta = DEBUG_DIR / "login_errors"
        pasta.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        caminho = pasta / f"{ts}_{etapa}.png"
        page.screenshot(path=str(caminho), full_page=False)
        print(f"[DEBUG] Screenshot salvo: {caminho}", flush=True)
    except Exception as e_ss:
        print(f"Aviso: screenshot de login nao foi salvo: {e_ss}", flush=True)


def _digitar_humanizado(page, locator, valor: str, campo: str, delay_ms: int = 80) -> None:
    """
    Digita caractere a caractere com delay para simular comportamento humano.
    Mais eficaz que fill() ou set_native_value() para SPAs com deteccao de bot.
    """
    locator.wait_for(state="visible", timeout=5000)
    locator.click()
    page.wait_for_timeout(300)
    # Limpar campo antes de digitar
    locator.press("Control+A")
    locator.press("Backspace")
    page.wait_for_timeout(200)
    # Digitar caractere por caractere
    page.keyboard.type(valor, delay=delay_ms)
    page.wait_for_timeout(300)
    # Verificar se campo aceitou o valor; fallback para fill nativo
    valor_atual = _valor_locator(locator)
    if valor_atual != valor:
        print(f"[AVISO] Typing humanizado falhou no campo {campo} ({len(valor_atual)}/{len(valor)} chars) — usando fill.", flush=True)
        _digitar_locator(locator, valor, campo)
    else:
        print(f"Campo {campo} preenchido com sucesso ({len(valor_atual)} chars via keyboard.type).", flush=True)


def _executar_login(page, usuario: str | None, senha: str | None, timeout_ms: int) -> None:
    if not usuario or not senha:
        raise RuntimeError(
            "Sessao expirou e nao ha credenciais configuradas para login automatico."
        )

    # Detectar ambiente servidor (Linux sem display = Render/produção)
    em_servidor = (os.name != "nt") and not os.environ.get("DISPLAY")
    # Fator 1.2 no servidor: conexão Render→Sankhya testada e estável — não precisa dobrar
    fator = 1.2 if em_servidor else 1

    print(f"URL atual antes do login: {getattr(page, 'url', '?')}", flush=True)
    print(f"Ambiente servidor detectado: {em_servidor} (fator de espera: {fator}x)", flush=True)

    # ── Limpar estado de sessão anterior ──────────────────────────────────────
    try:
        page.context.clear_cookies()
        page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch(e) {} }")
        print("Cookies e storage limpos.", flush=True)
    except Exception as e_clear:
        print(f"Aviso: nao foi possivel limpar storage: {e_clear}", flush=True)

    # ── Navegar para a URL de login do Sankhya Experience ─────────────────────
    # application_id=6 garante que o login direcione para o Experience (não outras plataformas Sankhya).
    print(f"Navegando para {_SANKHYA_LOGIN_URL} ...", flush=True)
    try:
        page.goto(_SANKHYA_LOGIN_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        # Aguardar a SPA do Sankhya renderizar o formulário de login
        page.wait_for_timeout(int(3000 * fator))
        print(f"URL apos navegacao inicial de login: {getattr(page, 'url', '?')}", flush=True)
    except Exception as e_nav:
        print(f"Aviso: goto login falhou ({e_nav}); prosseguindo com pagina atual.", flush=True)

    # ── Passo 1: preencher e-mail ──────────────────────────────────────────────
    print("Aguardando campo de e-mail aparecer...", flush=True)
    campo_usuario = _first_visible_locator(page, USER_SELECTORS, int(12000 * fator))
    if not campo_usuario:
        _capturar_screenshot_login(page, "sem_campo_email")
        raise RuntimeError(
            f"Campo de usuario nao encontrado. URL: {getattr(page, 'url', '?')}"
        )

    print(f"Campo de e-mail detectado. Digitando usuario ({len(usuario)} chars)...", flush=True)
    _digitar_humanizado(page, campo_usuario, usuario, "usuario")
    page.wait_for_timeout(int(1000 * fator))

    # ── Passo 2: avançar para a tela de senha ────────────────────────────────
    if not _first_visible_locator(page, PASSWORD_SELECTORS, 2000):
        print("Campo de senha nao visivel — procurando botao Prosseguir...", flush=True)
        clicou_proximo = _click_first_visible(page, NEXT_SELECTORS, 5000)
        if clicou_proximo:
            print("Botao Prosseguir clicado. Aguardando SPA transicionar para senha...", flush=True)
        else:
            print("Prosseguir nao encontrado — pressionando Enter no campo usuario.", flush=True)
            try:
                campo_usuario.press("Enter")
            except Exception:
                pass

        # Aguardar transição da SPA — no servidor pode demorar mais por latência de rede
        page.wait_for_timeout(int(3500 * fator))

        # Detectar mensagem de erro após clicar Prosseguir (email invalido, bloqueio etc.)
        mensagem_erro = _capturar_feedback_tela(page)
        if mensagem_erro:
            print(f"[TELA] Mensagem apos Prosseguir: {mensagem_erro}", flush=True)

        print(f"URL apos Prosseguir: {getattr(page, 'url', '?')}", flush=True)

    # ── Passo 3: preencher senha ───────────────────────────────────────────────
    print("Aguardando campo de senha aparecer...", flush=True)
    campo_senha = _first_visible_locator(page, PASSWORD_SELECTORS, timeout_ms)
    if not campo_senha:
        _capturar_screenshot_login(page, "sem_campo_senha")
        raise RuntimeError(
            f"Campo de senha nao encontrado apos Prosseguir. URL: {getattr(page, 'url', '?')}"
        )

    print(f"Campo de senha detectado. Digitando ({len(senha)} chars)...", flush=True)
    _digitar_humanizado(page, campo_senha, senha, "senha", delay_ms=60)
    page.wait_for_timeout(int(1200 * fator))

    # ── Passo 4: submeter ─────────────────────────────────────────────────────
    print("Submetendo formulario de login...", flush=True)
    submeteu = _click_first_visible(page, SUBMIT_SELECTORS, 5000)
    if submeteu:
        print("Botao de submit clicado com sucesso.", flush=True)
    else:
        print("Submit nao encontrado — pressionando Enter no campo senha.", flush=True)
        try:
            campo_senha.press("Enter")
        except Exception:
            pass

    print("Aguardando conclusao do login...", flush=True)
    _aguardar_login_concluir(page, timeout_ms)


def _garantir_sessao(page, os_data: dict, config: RPAConfig) -> None:
    target_url = str(os_data["experience_url_etapas"])

    print(f"Abrindo URL da empresa: {target_url}", flush=True)
    _navegar_sankhya(page, target_url, config.timeout_ms, "entrada inicial")
    print(f"URL apos navegacao inicial: {getattr(page, 'url', '?')}", flush=True)
    try:
        _wait_for_gestao(page, min(config.timeout_ms, 12000))
        print("Tela de gestao da OS detectada sem novo login.", flush=True)
        return
    except Exception as e_gestao:
        print(f"Tela de gestao ainda nao disponivel: {e_gestao}", flush=True)
        if not _pagina_pede_login(page):
            # Com IP brasileiro, o Sankhya pode nao redirecionar para login.sankhya.com.br
            # explicitamente — a SPA carrega na URL correta mas exige autenticacao.
            # Sempre tentar login quando a tela de gestao nao ficou disponivel.
            print(
                "URL nao indica login explicitamente mas gestao indisponivel — "
                "tentando autenticar de qualquer forma.",
                flush=True,
            )

    ultimo_erro: Exception | None = None
    tentativas_login = max(2, min(config.tentativas + 1, 3))

    for tentativa_login in range(1, tentativas_login + 1):
        if tentativa_login > 1:
            print(
                f"Recuperacao de sessao Sankhya: nova tentativa de login ({tentativa_login}/{tentativas_login}).",
                flush=True,
            )
            try:
                _navegar_sankhya(
                    page,
                    target_url,
                    config.timeout_ms,
                    f"recuperacao login {tentativa_login}",
                )
                if not _pagina_pede_login(page):
                    _wait_for_gestao(page, min(config.timeout_ms, 12000))
                    print("Tela de gestao da OS detectada durante recuperacao.", flush=True)
                    return
            except Exception as e_recuperacao_nav:
                print(f"Navegacao de recuperacao ainda exige login: {e_recuperacao_nav}", flush=True)

        try:
            _executar_login(page, os_data.get("exp_usuario"), os_data.get("exp_senha"), config.timeout_ms)
            print("Login concluido. Navegando para URL da OS.", flush=True)
            _navegar_sankhya(page, target_url, config.timeout_ms, "retorno apos login")
            print(f"URL apos login e retorno: {getattr(page, 'url', '?')}", flush=True)
            try:
                _wait_for_gestao(page, config.timeout_ms)
                print("Tela de gestao da OS detectada apos login.", flush=True)
                return
            except Exception as e_pos_login:
                ultimo_erro = e_pos_login
                print(f"Tela de gestao nao apareceu apos login direto: {e_pos_login}", flush=True)
                if _pagina_pede_login(page):
                    print(
                        "Sankhya redirecionou de volta para autenticacao apos validar o login.",
                        flush=True,
                    )
                    continue
        except Exception as e_login:
            ultimo_erro = e_login
            if tentativa_login < tentativas_login and _pagina_pede_login(page):
                print(f"Tentativa de login rejeitada pelo Sankhya: {e_login}", flush=True)
                page.wait_for_timeout(1500)
                continue
            break

    _capturar_screenshot_login(page, "sessao_rejeitada")
    raise RuntimeError(
        "Sankhya rejeitou a sessao apos validar o login "
        f"em {tentativas_login} tentativa(s). Ultimo erro: {ultimo_erro}"
    )


def _habilitar_webauthn_virtual(context, page):
    try:
        session = context.new_cdp_session(page)
        session.send("WebAuthn.enable")
        authenticator_id = session.send(
            "WebAuthn.addVirtualAuthenticator",
            {
                "options": {
                    "protocol": "ctap2",
                    "transport": "internal",
                    "hasResidentKey": True,
                    "hasUserVerification": True,
                    "isUserVerified": True,
                    "automaticPresenceSimulation": True,
                }
            },
        ).get("authenticatorId")
        print(f"WebAuthn virtual habilitado para o navegador ({authenticator_id}).", flush=True)
        return session
    except Exception as e_webauthn:
        print(f"Aviso: nao foi possivel habilitar WebAuthn virtual: {e_webauthn}", flush=True)
        return None


def _texto_notificacoes_toast(page) -> str | None:
    try:
        textos = []
        for texto in page.locator(".rnc__notification-message").all_inner_texts():
            texto_normalizado = " ".join(texto.split())
            if texto_normalizado and texto_normalizado not in textos:
                textos.append(texto_normalizado)
        if textos:
            return " | ".join(textos)
    except Exception:
        pass
    return None


def _fechar_todas_notificacoes_toast(page, timeout_ms: int = 3000) -> None:
    """
    Fecha todos os toasts de notificação abertos, clicando no "X"
    (rnc__notification-close-mark) de cada um. Os toasts não somem
    automaticamente da tela; se deixados abertos, eles se acumulam e passam a
    interceptar cliques destinados aos elementos da próxima OS, travando a
    automação.
    """
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        marca = page.locator(".rnc__notification-close-mark").first
        try:
            if marca.count() == 0:
                break
            marca.click(timeout=1000)
        except Exception:
            break
        page.wait_for_timeout(200)

    # O wrapper do toast anima a altura para 0 (600ms) antes de sair do DOM.
    # Enquanto essa animacao roda ele ainda ocupa espaco na tela e pode
    # interceptar cliques (ex.: no botao Cancelar) — por isso aguarda sumir.
    try:
        page.locator(".rnc__notification").first.wait_for(state="hidden", timeout=timeout_ms)
    except Exception:
        pass


def _cancelar_formulario(page, os_data: dict | None = None) -> bool:
    for selector in ("#cancelar-button", "button:has-text('Cancelar')"):
        locator = page.locator(selector).first
        try:
            if locator.count() > 0 and locator.is_visible():
                locator.click(timeout=5000)
                if os_data:
                    _log_os(os_data, f"Clique em Cancelar via '{selector}'.")
                return True
        except Exception as exc:
            if os_data:
                _log_os(os_data, f"AVISO: falha ao clicar em Cancelar via '{selector}': {exc}")
            continue
    if os_data:
        _log_os(os_data, "AVISO: botao Cancelar nao encontrado ou nao visivel.")
    return False


def _log_os(os_data: dict, mensagem: str) -> None:
    print(
        f"[OS {os_data.get('ticket') or '-'} | {os_data.get('empresa') or '-'}] {mensagem}",
        flush=True,
    )


def _esta_visivel(page, selector: str) -> bool:
    locator = page.locator(selector).first
    try:
        return locator.count() > 0 and locator.is_visible()
    except Exception:
        return False


def _fechar_swal_se_visivel(page, os_data: dict) -> bool:
    """Fecha o dialog swal2 se estiver visível. Retorna True se encontrou e clicou."""
    for selector in SWAL_FECHAR_SELECTORS:
        locator = page.locator(selector).first
        try:
            if locator.count() > 0 and locator.is_visible():
                feedback = _capturar_feedback_tela(page)
                if feedback:
                    _log_os(os_data, f"Dialog swal2 detectado: {feedback}")
                _log_os(os_data, f"Fechando dialog via '{selector}'.")
                locator.click()
                page.wait_for_timeout(400)
                # Verificar se o popup sumiu; se não, tentar novamente com Escape
                popup = page.locator(".swal2-popup").first
                if popup.count() > 0 and popup.is_visible():
                    _log_os(os_data, "Popup ainda visivel apos clique — pressionando Escape.")
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(300)
                return True
        except Exception:
            continue
    return False


def _capturar_feedback_tela(page) -> str:
    selectors = (
        ".swal2-title",
        ".swal2-html-container",
        ".swal2-popup",
        ".p-error",
        ".ant-form-item-explain-error",
        "[role='alert']",
        ".toast-message",
    )
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.count() > 0 and locator.is_visible():
                texto = " ".join(locator.inner_text(timeout=1000).split())
                if texto:
                    return texto[:300]
        except Exception:
            continue
    return ""


def _aguardar_os_finalizada(page, os_data: dict, timeout_ms: int) -> None:
    deadline = time.monotonic() + (timeout_ms / 1000)
    ultimo_feedback = ""
    fechamentos_swal = 0

    while time.monotonic() < deadline:
        if _pagina_pede_login(page):
            raise RuntimeError("Sessao voltou para a tela de login durante a gravacao da OS.")

        # Fechar qualquer dialog swal2 que apareça (sucesso, aviso, etc.)
        # Limite de 10 para não entrar em loop infinito se algo inesperado mantiver popup aberto
        if fechamentos_swal < 10 and _fechar_swal_se_visivel(page, os_data):
            fechamentos_swal += 1
            continue

        feedback = _capturar_feedback_tela(page)
        if feedback and feedback != ultimo_feedback:
            _log_os(os_data, f"Feedback de tela: {feedback}")
            ultimo_feedback = feedback

        formulario_aberto = any(
            _esta_visivel(page, selector)
            for selector in (
                "#salvar-button",
                "#application",
                "#person",
                "#date_to_do input[data-pc-section='root']",
            )
        )
        lista_pronta = _esta_visivel(page, "button:has-text('Novo')") or _esta_visivel(page, "span.checkbox-activity")

        if not formulario_aberto and lista_pronta:
            _log_os(os_data, "Formulario fechado e tela principal restaurada.")
            return

        page.wait_for_timeout(250)

    detalhe = _capturar_feedback_tela(page)
    raise RuntimeError(
        "Fluxo nao confirmou a finalizacao da OS."
        + (f" Ultimo feedback: {detalhe}" if detalhe else "")
    )


def _aguardar_resultado_salvar(page, os_data: dict, timeout_ms: int) -> str | None:
    """
    Aguarda o resultado do clique em Salvar: ou o formulario fecha (sucesso,
    retorna None), ou aparece algum toast de notificacao (falha, retorna o
    texto da(s) mensagem(ns)).

    A checagem da notificacao roda dentro do mesmo loop que aguarda o
    fechamento do formulario (em vez de uma janela fixa e curta antes dele)
    porque o tempo de resposta do servidor varia — uma janela curta pode
    checar a tela antes do toast aparecer e assumir sucesso por engano,
    deixando o erro real ser descoberto só quando o timeout de finalizacao
    (bem maior) se esgota.
    """
    deadline = time.monotonic() + (timeout_ms / 1000)
    ultimo_feedback = ""
    fechamentos_swal = 0

    while time.monotonic() < deadline:
        if _pagina_pede_login(page):
            raise RuntimeError("Sessao voltou para a tela de login durante a gravacao da OS.")

        notificacao = _texto_notificacoes_toast(page)
        if notificacao:
            return notificacao

        if fechamentos_swal < 10 and _fechar_swal_se_visivel(page, os_data):
            fechamentos_swal += 1
            continue

        feedback = _capturar_feedback_tela(page)
        if feedback and feedback != ultimo_feedback:
            _log_os(os_data, f"Feedback de tela: {feedback}")
            ultimo_feedback = feedback

        formulario_aberto = any(
            _esta_visivel(page, selector)
            for selector in (
                "#salvar-button",
                "#application",
                "#person",
                "#date_to_do input[data-pc-section='root']",
            )
        )
        lista_pronta = _esta_visivel(page, "button:has-text('Novo')") or _esta_visivel(page, "span.checkbox-activity")

        if not formulario_aberto and lista_pronta:
            _log_os(os_data, "Formulario fechado e tela principal restaurada.")
            return None

        page.wait_for_timeout(250)

    detalhe = _capturar_feedback_tela(page)
    raise RuntimeError(
        "Fluxo nao confirmou a finalizacao da OS."
        + (f" Ultimo feedback: {detalhe}" if detalhe else "")
    )


def executar_fluxo_completo(lista_os: list, config: dict | None = None) -> dict:
    rpa_config = _build_config(config)

    print("\n==================================================", flush=True)
    print("INICIANDO AUTOMACAO COMPLETA DE OS", flush=True)
    print("==================================================\n", flush=True)

    erros = []
    sucessos = []
    itens_pendentes = {id(os_data): os_data for os_data in lista_os}
    erro_critico: str | None = None

    try:
        grupos = defaultdict(list)
        for os_data in lista_os:
            grupos[os_data["empresa"]].append(os_data)

        with sync_playwright() as p:
            # Em ambientes sem display (Linux sem X Server, ex: Fly.io), forcar headless
            sem_display = (os.name != "nt") and not os.environ.get("DISPLAY")
            headless = True if sem_display else rpa_config.headless

            if sem_display and not rpa_config.headless:
                print(
                    "AVISO: rpa_headless=False ignorado — ambiente sem display detectado (sem DISPLAY). "
                    "Usando headless=True automaticamente.",
                    flush=True,
                )

            # Args sempre necessarios em servidores Linux.
            # disable-blink-features=AutomationControlled evita que SPAs (como Sankhya)
            # detectem o Playwright como bot e alterem o comportamento do login.
            base_args = [
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-default-apps",
                "--disable-gpu",
                "--disable-hang-monitor",
                "--disable-popup-blocking",
                "--disable-prompt-on-repost",
                "--disable-renderer-backgrounding",
                "--disable-sync",
                "--metrics-recording-only",
                "--mute-audio",
                "--no-first-run",
                "--no-zygote",
                "--lang=pt-BR",
            ]

            # User-Agent sem "HeadlessChrome" — o Sankhya detecta o UA padrao do
            # Playwright headless e invalida a sessao antes mesmo de processar as credenciais.
            user_agent = os.environ.get("RPA_USER_AGENT") or (
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/139.0.0.0 Safari/537.36"
            )

            # Perfil persistente tanto no servidor quanto localmente.
            # Reutilizar o perfil entre execuções preserva cookies/sessão do Sankhya,
            # permitindo que runs subsequentes pulem o login se a sessão ainda for válida.
            profile_subdir = "sankhya_profile_server" if sem_display else "sankhya_profile"
            user_data_dir_path = (
                Path(__file__).resolve().parents[2] / "runtime" / profile_subdir
            )
            user_data_dir_path.mkdir(parents=True, exist_ok=True)
            user_data_dir = str(user_data_dir_path)
            print(
                f"Perfil do navegador: {user_data_dir_path.name} "
                f"({'servidor' if sem_display else 'local'})",
                flush=True,
            )

            launch_kwargs: dict = {
                "user_data_dir": user_data_dir,
                "headless": headless,
                "args": base_args,
                "ignore_default_args": ["--enable-automation"],
                "user_agent": user_agent,
                "locale": "pt-BR",
                "timezone_id": "America/Sao_Paulo",
                "extra_http_headers": {
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "sec-ch-ua": '"Google Chrome";v="139", "Chromium";v="139", "Not_A Brand";v="99"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"Linux"',
                },
            }
            if headless:
                launch_kwargs["viewport"] = {"width": 1600, "height": 900}
            else:
                launch_kwargs["args"].append("--start-maximized")
                launch_kwargs["no_viewport"] = True

            # Proxy brasileiro opcional — configurar RPA_PROXY_SERVER no painel do Fly.io
            # Formato: http://usuario:senha@host:porta  (suporta http, socks5)
            # Exemplo com proxy residencial BR: socks5://user:pass@br.proxy.example.com:1080
            proxy_server = os.environ.get("RPA_PROXY_SERVER", "").strip()
            if proxy_server:
                launch_kwargs["proxy"] = {"server": proxy_server}
                print(f"Proxy configurado: {proxy_server.split('@')[-1]}", flush=True)
            else:
                print(
                    "Sem proxy configurado (RPA_PROXY_SERVER). "
                    "Se o Sankhya bloquear o IP do Fly.io, configure um proxy BR.",
                    flush=True,
                )

            # Configurar gravacao de debug se ativado
            execucao_ts = time.strftime("%Y%m%d_%H%M%S")
            debug_dir_execucao = DEBUG_DIR / execucao_ts
            if rpa_config.debug_video or rpa_config.debug_trace:
                debug_dir_execucao.mkdir(parents=True, exist_ok=True)
                print(f"[DEBUG] Gravacao ativada em: {debug_dir_execucao}", flush=True)
            if rpa_config.debug_video:
                launch_kwargs["record_video_dir"] = str(debug_dir_execucao)
                launch_kwargs["record_video_size"] = {"width": 1600, "height": 900}

            context = p.chromium.launch_persistent_context(**launch_kwargs)
            page = context.pages[0] if context.pages else context.new_page()
            for extra_page in context.pages[1:]:
                try:
                    extra_page.close()
                except Exception:
                    pass

            if rpa_config.debug_trace:
                context.tracing.start(screenshots=True, snapshots=True, sources=False)

            page.set_default_timeout(rpa_config.timeout_ms)
            page.set_default_navigation_timeout(rpa_config.timeout_ms)
            page.on("console", lambda msg: print(f"[Browser] {msg.text}", flush=True))
            page.on("pageerror", lambda exc: print(f"[Browser pageerror] {exc}", flush=True))
            page.on("crash", lambda _: print("[Browser] pagina do Chromium travou.", flush=True))
            context.on("close", lambda _: print("[Browser] contexto Chromium fechado.", flush=True))

            # ── Patches anti-detecção de bot (aplicados em todas as páginas do contexto) ──
            context.add_init_script("""
                // 1. navigator.webdriver — sinal mais básico de headless
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

                // 2. Plugins simulados (headless tem 0 plugins por padrão)
                const pluginArr = [1, 2, 3, 4, 5];
                pluginArr.item = (i) => pluginArr[i] || null;
                pluginArr.namedItem = () => null;
                pluginArr.refresh = () => {};
                Object.defineProperty(navigator, 'plugins', { get: () => pluginArr });
                Object.defineProperty(navigator, 'mimeTypes', { get: () => [1, 2] });

                // 3. Idioma / região
                Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
                Object.defineProperty(navigator, 'language', { get: () => 'pt-BR' });

                // 4. Hardware
                Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
                Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

                // 5. Conexão de rede simulada (evita fingerprint de "sem conexão real")
                Object.defineProperty(navigator, 'connection', {
                  get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
                });

                // 6. userAgentData (Client Hints API — Chromium 130+)
                Object.defineProperty(navigator, 'userAgentData', {
                  get: () => ({
                    brands: [
                      { brand: 'Google Chrome', version: '139' },
                      { brand: 'Chromium', version: '139' },
                      { brand: 'Not_A Brand', version: '99' },
                    ],
                    mobile: false,
                    platform: 'Linux',
                    getHighEntropyValues: async () => ({
                      architecture: 'x86', bitness: '64', mobile: false,
                      model: '', platform: 'Linux', platformVersion: '6.1.0',
                      uaFullVersion: '139.0.0.0', wow64: false,
                      brands: [
                        { brand: 'Google Chrome', version: '139' },
                        { brand: 'Chromium', version: '139' },
                        { brand: 'Not_A Brand', version: '99' },
                      ],
                      fullVersionList: [
                        { brand: 'Google Chrome', version: '139.0.0.0' },
                        { brand: 'Chromium', version: '139.0.0.0' },
                        { brand: 'Not_A Brand', version: '99.0.0.0' },
                      ],
                    }),
                  }),
                });

                // 7. chrome runtime (ausente em headless sem este patch)
                window.chrome = {
                  runtime: {
                    connect: () => ({}),
                    sendMessage: () => {},
                    onMessage: { addListener: () => {}, removeListener: () => {} },
                    id: undefined,
                  },
                  loadTimes: () => ({}),
                  csi: () => ({}),
                  app: {},
                };

                // 8. Permission API — Notifications aparecem como "default" em vez de "denied"
                // (headless retorna "denied" sem esta correção, o que é um sinal de bot)
                try {
                  const origQuery = window.navigator.permissions.query.bind(navigator.permissions);
                  window.navigator.permissions.query = (params) =>
                    params.name === 'notifications'
                      ? Promise.resolve({ state: Notification.permission })
                      : origQuery(params);
                } catch (_) {}

                // 9. WebGL vendor — headless retorna strings genéricas do SwiftShader/llvmpipe
                try {
                  const patchGL = (GL) => {
                    const orig = GL.prototype.getParameter;
                    GL.prototype.getParameter = function(p) {
                      if (p === 37445) return 'Intel Inc.';
                      if (p === 37446) return 'Intel Iris OpenGL Engine';
                      return orig.apply(this, [p]);
                    };
                  };
                  patchGL(WebGLRenderingContext);
                  if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext);
                } catch (_) {}
            """)

            # playwright-stealth removido: os scripts injetados causavam erros JS
            # ("utils is not defined", "opts is not defined") que quebravam a SPA
            # do Sankhya, impedindo o formulario de login de renderizar.
            # Os patches manuais acima (navigator.webdriver, WebGL, Permission API etc.)
            # sao suficientes com IP brasileiro.
            print("Patches anti-deteccao aplicados (modo manual).", flush=True)

            webauthn_session = _habilitar_webauthn_virtual(context, page)

            for empresa, lista_empresa in grupos.items():
                print(f"\nPROCESSANDO EMPRESA: {empresa}", flush=True)

                try:
                    _garantir_sessao(page, lista_empresa[0], rpa_config)
                except Exception as e_nav:
                    print(f"Falha ao abrir empresa {empresa}: {e_nav}", flush=True)
                    for os_data in lista_empresa:
                        erros.append(
                            {
                                **os_data,
                                "motivo": (
                                    f"Falha ao navegar/autenticar na empresa {empresa}: {str(e_nav)}"
                                ),
                            }
                        )
                    continue

                for os_data in lista_empresa:
                    erro_info = None
                    os_aberta = False

                    for tentativa in range(1, rpa_config.tentativas + 1):
                        try:
                            sucesso, erro_info = executar_os(
                                page,
                                os_data,
                                timeout_ms=rpa_config.timeout_ms,
                            )
                            if sucesso:
                                os_aberta = True
                                sucessos.append(os_data)
                                itens_pendentes.pop(id(os_data), None)
                                print(
                                    f"SUCESSO | Linha: {os_data.get('linha_id')} "
                                    f"| Empresa: {os_data.get('empresa')} "
                                    f"| Usuario: {os_data.get('usuario')} "
                                    f"| OS: {os_data.get('ticket')}",
                                    flush=True,
                                )
                                break
                            if erro_info and erro_info.get("toast_erro"):
                                # Erro reportado pela propria tela (toast) — repetir a
                                # tentativa tende a reproduzir o mesmo erro; pula para a próxima OS.
                                break
                        except Exception as exc:
                            traceback.print_exc()
                            erro_info = {**os_data, "motivo": f"Erro inesperado: {str(exc)}"}

                        if tentativa < rpa_config.tentativas:
                            print(
                                f"Nova tentativa da OS {os_data.get('ticket')} "
                                f"({tentativa}/{rpa_config.tentativas})",
                                flush=True,
                            )
                            try:
                                _garantir_sessao(page, os_data, rpa_config)
                            except Exception as retry_nav_exc:
                                erro_info = {
                                    **os_data,
                                    "motivo": (
                                        "Falha ao reabrir a tela antes da nova tentativa: "
                                        f"{str(retry_nav_exc)}"
                                    ),
                                }
                                break
                            if rpa_config.delay_entre_os_ms:
                                page.wait_for_timeout(rpa_config.delay_entre_os_ms)

                    if os_aberta:
                        if rpa_config.delay_entre_os_ms:
                            page.wait_for_timeout(rpa_config.delay_entre_os_ms)
                        continue

                    erros.append(erro_info or {**os_data, "motivo": "Falha sem detalhe."})
                    itens_pendentes.pop(id(os_data), None)
                    print(
                        f"FALHA | Linha: {os_data.get('linha_id')} "
                        f"| Empresa: {os_data.get('empresa')} "
                        f"| Usuario: {os_data.get('usuario')} "
                        f"| OS: {os_data.get('ticket')}",
                        flush=True,
                    )

            if rpa_config.debug_trace:
                trace_path = str(debug_dir_execucao / "trace.zip")
                try:
                    context.tracing.stop(path=trace_path)
                    print(f"[DEBUG] Trace salvo: {trace_path}", flush=True)
                except Exception as e_trace:
                    print(f"[DEBUG] Falha ao salvar trace: {e_trace}", flush=True)

            context.close()

            if rpa_config.debug_video:
                print(f"[DEBUG] Video(s) salvos em: {debug_dir_execucao}", flush=True)

    except PlaywrightTimeout as exc:
        erro_critico = f"Timeout detectado na automacao: {str(exc)}"
        print(erro_critico, flush=True)
        traceback.print_exc()
    except Exception as exc:
        erro_critico = f"ERRO CRITICO NA AUTOMACAO: {str(exc)}"
        print(erro_critico, flush=True)
        traceback.print_exc()
    finally:
        if erro_critico:
            for os_data in list(itens_pendentes.values()):
                erros.append({**os_data, "motivo": erro_critico})

        print("\n==================================================", flush=True)
        print("RELATORIO FINAL DA EXECUCAO", flush=True)
        print("==================================================", flush=True)
        print(f"Total Sucesso: {len(sucessos)}", flush=True)
        print(f"Total Falha: {len(erros)}", flush=True)
        print("\nExecucao finalizada.\n", flush=True)

        pass

    return {"sucesso": sucessos, "falha": erros}


def executar_os(page, os_data: dict, timeout_ms: int = 30000) -> tuple[bool, dict | None]:
    print(f"\nLancando OS: {os_data['ticket']} (Linha {os_data.get('linha_id')})", flush=True)
    _log_os(os_data, "Validando tela inicial da automacao.")

    _wait_for_gestao(page, timeout_ms)

    if page.locator("span.checkbox-activity").count() == 0:
        _log_os(os_data, "Marcando processo Atendimento Avulso.")
        page.locator("div.process-check", has_text="Atendimento Avulso").click()

    if page.locator("div.p-checkbox.p-highlight").count() == 0:
        _log_os(os_data, "Ativando checkbox da atividade.")
        page.locator("span.checkbox-activity").first.click()

    _fechar_todas_notificacoes_toast(page)

    if _esta_visivel(page, "#salvar-button") or _esta_visivel(page, "#cancelar-button"):
        _log_os(os_data, "AVISO: formulario de OS anterior ainda aberto — cancelando antes de continuar.")
        _cancelar_formulario(page, os_data)
        try:
            _aguardar_os_finalizada(page, os_data, timeout_ms)
        except Exception as e_aguardar:
            _log_os(os_data, f"AVISO: nao foi possivel confirmar fechamento do formulario anterior: {e_aguardar}")

    _log_os(os_data, "Abrindo formulario de nova OS.")
    page.get_by_role("button", name="Novo").click()
    page.wait_for_selector("#application", state="visible", timeout=timeout_ms)

    _log_os(os_data, "Carregando pedidos disponíveis.")
    page.locator("#application").click()
    page.wait_for_selector("li[role='option']", timeout=timeout_ms)

    opcoes = page.locator("li[role='option']")
    total_opcoes = opcoes.count()
    maior_codigo = -1
    opcao_escolhida = None
    label_escolhida = ""

    for i in range(total_opcoes):
        label = opcoes.nth(i).get_attribute("aria-label") or ""
        match = re.search(r"(\d+)", label)
        if match:
            codigo = int(match.group(1))
            if codigo > maior_codigo:
                maior_codigo = codigo
                opcao_escolhida = opcoes.nth(i)
                label_escolhida = label

    if not opcao_escolhida:
        _cancelar_formulario(page)
        return False, {**os_data, "motivo": "Nenhum codigo de pedido encontrado para a empresa."}

    # Valida saldo do pedido antes de lancar: se a OS consome mais horas do que
    # o pedido tem disponivel, nao lanca — marca como erro de saldo e pula.
    saldo_pedido = _saldo_pedido_minutos(label_escolhida)
    duracao_os = _duracao_os_minutos(os_data)
    if saldo_pedido is not None and duracao_os is not None and duracao_os > saldo_pedido:
        _log_os(
            os_data,
            f"Saldo insuficiente no pedido {maior_codigo}: OS consome "
            f"{_minutos_para_hhmm(duracao_os)} e o pedido tem saldo de "
            f"{_minutos_para_hhmm(saldo_pedido)}.",
        )
        _cancelar_formulario(page)
        return (
            False,
            {
                **os_data,
                "motivo": (
                    f"Erro de saldo de horas: a OS consome {_minutos_para_hhmm(duracao_os)} "
                    f"e o pedido {maior_codigo} tem saldo de {_minutos_para_hhmm(saldo_pedido)}."
                ),
            },
        )
    if saldo_pedido is None:
        _log_os(os_data, f"Saldo do pedido {maior_codigo} nao pode ser lido do dropdown — seguindo sem validacao de saldo.")

    _log_os(os_data, f"Selecionando pedido com maior codigo: {maior_codigo} (saldo do pedido: {_minutos_para_hhmm(saldo_pedido) if saldo_pedido is not None else '?'}).")
    opcao_escolhida.click()

    _log_os(os_data, f"Buscando usuario '{os_data['usuario']}'.")
    campo_usuario = page.locator("#person")

    # Limpar campo e garantir que dropdown anterior fechou antes de digitar novo nome
    campo_usuario.click(click_count=3)
    page.keyboard.press("Delete")
    try:
        page.wait_for_selector("li[role='option']", state="hidden", timeout=2000)
    except Exception:
        pass  # nenhum dropdown aberto, prosseguir normalmente
    page.wait_for_timeout(400)
    page.keyboard.type(str(os_data["usuario"]))

    try:
        page.wait_for_selector("li[role='option']", state="visible", timeout=timeout_ms)
    except Exception:
        _log_os(
            os_data,
            (
                f"Lista de usuarios nao carregou para '{os_data['usuario']}' "
                f"na empresa {os_data.get('empresa', '')}."
            ),
        )
        _cancelar_formulario(page)
        return (
            False,
            {
                **os_data,
                "motivo": (
                    f"Lista de usuarios nao carregou ao buscar '{os_data['usuario']}' "
                    f"na empresa {os_data.get('empresa', '')}"
                ),
            },
        )

    opcoes_usuario = page.locator("li[role='option']")
    total_opcoes = opcoes_usuario.count()
    _log_os(os_data, f"Busca de usuario retornou {total_opcoes} opcao(oes).")
    if total_opcoes == 0:
        _log_os(
            os_data,
            (
                f"Nenhuma opcao retornada para '{os_data['usuario']}' "
                f"na empresa {os_data.get('empresa', '')}."
            ),
        )
        _cancelar_formulario(page)
        return (
            False,
            {
                **os_data,
                "motivo": (
                    f"Nenhum usuario retornado ao buscar '{os_data['usuario']}' "
                    f"na empresa {os_data.get('empresa', '')}"
                ),
            },
        )

    nome_planilha = normalizar(str(os_data["usuario"]))
    palavras_planilha = set(nome_planilha.split())
    # Exigir que TODAS as palavras do nome buscado estejam presentes na opcao.
    # Ex.: "Talita Costa" so aceita opcoes que contenham "talita" E "costa".
    minimo = len(palavras_planilha)
    candidatos_usuario: list[tuple[int, str]] = []
    # Cada entrada: (similaridade, -extras, texto_opcao, locator)
    candidatos_qualificados: list[tuple[float, int, str, object]] = []

    for i in range(total_opcoes):
        opcao = opcoes_usuario.nth(i)
        try:
            texto_opcao = normalizar(opcao.inner_text(timeout=5000))
        except Exception:
            continue

        palavras_opcao = set(texto_opcao.split())
        score = len(palavras_planilha & palavras_opcao)  # quantas palavras do nome buscado existem na opcao
        extras = len(palavras_opcao) - score             # palavras extras na opcao (nao estao no nome buscado)

        if texto_opcao:
            candidatos_usuario.append((score, texto_opcao))

        if score >= minimo:
            # Similaridade de string: captura casos como "Talita Costa" x "Talita Duarte Costa"
            similaridade = difflib.SequenceMatcher(None, nome_planilha, texto_opcao).ratio()
            candidatos_qualificados.append((similaridade, -extras, texto_opcao, opcao))

    if not candidatos_qualificados:
        resumo_candidatos = _resumir_candidatos_usuario(candidatos_usuario)
        _log_os(
            os_data,
            (
                f"Usuario nao localizado. Busca='{os_data['usuario']}', "
                f"minimo={minimo} palavra(s) devem coincidir, "
                f"opcoes={total_opcoes}. Candidatos: {resumo_candidatos}"
            ),
        )
        _cancelar_formulario(page)
        return (
            False,
            {
                **os_data,
                "motivo": (
                    f"Usuario '{os_data['usuario']}' nao encontrado na empresa "
                    f"{os_data.get('empresa', '')}. Nenhuma opcao continha todas as "
                    f"{minimo} palavra(s) do nome. Candidatos: {resumo_candidatos}"
                ),
            },
        )

    # Ordenar por maior similaridade; em empate, menos palavras extras (match mais exato)
    candidatos_qualificados.sort(key=lambda x: (x[0], x[1]), reverse=True)

    # Detectar ambiguidade: se os dois primeiros tiverem similarity muito proxima (<0.15),
    # nao e seguro escolher — falhar em vez de arriscar abrir para a pessoa errada.
    if len(candidatos_qualificados) >= 2:
        sim_top = candidatos_qualificados[0][0]
        sim_segundo = candidatos_qualificados[1][0]
        if abs(sim_top - sim_segundo) < 0.15:
            nomes_ambiguos = " | ".join(c[2] for c in candidatos_qualificados[:3])
            _log_os(
                os_data,
                (
                    f"AMBIGUIDADE: multiplos candidatos similares para '{os_data['usuario']}' "
                    f"(sim1={sim_top:.2f}, sim2={sim_segundo:.2f}). Candidatos: {nomes_ambiguos}"
                ),
            )
            _cancelar_formulario(page)
            return (
                False,
                {
                    **os_data,
                    "motivo": (
                        f"Ambiguidade ao buscar '{os_data['usuario']}' na empresa "
                        f"{os_data.get('empresa', '')}: multiplos usuarios possiveis "
                        f"({nomes_ambiguos}). Torne o nome do executante mais especifico."
                    ),
                },
            )

    melhor_similaridade, _, melhor_texto, melhor_match = candidatos_qualificados[0]

    _log_os(
        os_data,
        f"Usuario selecionado (similaridade={melhor_similaridade:.2f}): "
        f"'{melhor_texto}' para busca '{os_data['usuario']}'.",
    )
    melhor_match.click()
    page.wait_for_timeout(300)

    # Verificar que o campo ficou preenchido apos a selecao
    try:
        valor_campo = campo_usuario.input_value()
        if not valor_campo:
            _log_os(os_data, "AVISO: campo usuario vazio apos selecao — tentando clicar novamente.")
            melhor_match.click()
            page.wait_for_timeout(300)
        else:
            _log_os(os_data, f"Campo usuario confirmado: '{valor_campo}'.")
    except Exception as e_verify:
        _log_os(os_data, f"Nao foi possivel verificar campo usuario pos-selecao: {e_verify}")

    data_experience = normalizar_data_experience(os_data.get("data"))
    _log_os(os_data, f"Preenchendo data {os_data.get('data')} -> {data_experience}.")
    campo_data = page.locator("#date_to_do input[data-pc-section='root']")
    campo_data.wait_for(state="visible", timeout=timeout_ms)
    _digitar_locator(campo_data, data_experience, "data_OS")
    page.wait_for_timeout(200)
    campo_data.press("Tab")

    hora_inicio = normalizar_hora(os_data.get("hora_inicio"))
    hora_fim = normalizar_hora(os_data.get("hora_fim"))
    _log_os(os_data, f"Hora inicio: {os_data.get('hora_inicio')} -> {hora_inicio}")
    _log_os(os_data, f"Hora fim: {os_data.get('hora_fim')} -> {hora_fim}")

    _log_os(os_data, "Preenchendo horas e observacao.")
    page.locator("#hour_to_start").fill(hora_inicio)
    page.locator("#hour_to_finish").fill(hora_fim)
    page.locator("#additional_information").fill(str(os_data.get("ticket") or ""))

    _log_os(os_data, "Acionando botao Salvar.")
    page.locator("#salvar-button").wait_for(state="visible", timeout=timeout_ms)
    page.locator("#salvar-button").click()

    _log_os(os_data, "Aguardando resposta do servidor e fechamento do formulario.")
    notificacao = _aguardar_resultado_salvar(page, os_data, timeout_ms)
    if notificacao:
        _log_os(os_data, f"FALHA: {notificacao}")
        _fechar_todas_notificacoes_toast(page)
        cancelou = _cancelar_formulario(page, os_data)
        if not cancelou:
            page.wait_for_timeout(500)
            cancelou = _cancelar_formulario(page, os_data)
        try:
            _aguardar_os_finalizada(page, os_data, timeout_ms)
        except Exception as e_aguardar:
            _log_os(
                os_data,
                f"AVISO: nao foi possivel confirmar fechamento do formulario apos cancelar: {e_aguardar}",
            )
        return False, {
            **os_data,
            "motivo": notificacao,
            "toast_erro": True,
        }

    print(f"OS {os_data['ticket']} concluida com sucesso.", flush=True)
    return True, None
