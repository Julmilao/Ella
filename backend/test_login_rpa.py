#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_login_rpa.py — Diagnóstico completo de login RPA no Sankhya Experience.

Uso:
    python test_login_rpa.py

Variáveis de ambiente:
    TEST_EXP_USUARIO    e-mail do usuário Sankhya (obrigatório)
    TEST_EXP_SENHA      senha do usuário Sankhya (obrigatório)
    TEST_EXP_URL        URL da empresa no Experience (opcional — testa navegação pós-login)
    TEST_PROXY          proxy BR opcional  ex: socks5://user:pass@host:1080
    TEST_TIMEOUT_MS     timeout em ms (default: 45000)
    TEST_SS_DIR         pasta para screenshots (default: ./debug_screenshots)
    TEST_SKIP_IP        1 para pular checagem de IP externo
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

# ── Configuração via env ──────────────────────────────────────────────────────

USUARIO     = os.environ.get("TEST_EXP_USUARIO", "").strip()
SENHA       = os.environ.get("TEST_EXP_SENHA", "").strip()
EXP_URL     = os.environ.get("TEST_EXP_URL", "").strip()
PROXY       = os.environ.get("TEST_PROXY", "").strip()
TIMEOUT_MS  = int(os.environ.get("TEST_TIMEOUT_MS", "45000"))
SS_DIR      = Path(os.environ.get("TEST_SS_DIR", "./debug_screenshots"))
SKIP_IP     = os.environ.get("TEST_SKIP_IP", "0").strip() == "1"

LOGIN_URL = (
    "https://login.sankhya.com.br/"
    "?redirect_to=https://experience.sankhya.com.br/projeto"
    "&application_id=6"
)

# ── Logging com timestamp relativo ───────────────────────────────────────────

_START = time.monotonic()


def log(msg: str, level: str = "INFO") -> None:
    elapsed = time.monotonic() - _START
    prefix = f"[{elapsed:08.3f}s] [{level}]"
    print(f"{prefix} {msg}", flush=True)


def log_sep(titulo: str = "") -> None:
    linha = "─" * 60
    if titulo:
        print(f"\n{'─'*20} {titulo} {'─'*20}", flush=True)
    else:
        print(linha, flush=True)


def screenshot(page, nome: str) -> None:
    try:
        SS_DIR.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%H%M%S")
        caminho = SS_DIR / f"{ts}_{nome}.png"
        page.screenshot(path=str(caminho), full_page=False)
        log(f"Screenshot salvo: {caminho}")
    except Exception as e:
        log(f"Screenshot falhou ({nome}): {e}", "WARN")


# ── Checagem de IP público ────────────────────────────────────────────────────

def check_ip() -> dict:
    log_sep("IP PÚBLICO DO SERVIDOR")
    result = {"ip": "?", "country": "?", "region": "?", "org": "?"}

    if SKIP_IP:
        log("TEST_SKIP_IP=1 — pulando checagem de IP.")
        return result

    try:
        import urllib.request
        with urllib.request.urlopen("https://ipinfo.io/json", timeout=10) as resp:
            data = json.loads(resp.read().decode())
        result.update({
            "ip":      data.get("ip", "?"),
            "country": data.get("country", "?"),
            "region":  data.get("region", "?"),
            "org":     data.get("org", "?"),
        })
        log(f"IP público   : {result['ip']}")
        log(f"País         : {result['country']}")
        log(f"Região       : {result['region']}")
        log(f"Organização  : {result['org']}")

        if result["country"] != "BR":
            log(
                f"AVISO: IP fora do Brasil ({result['country']}) — "
                "este é provavelmente o motivo do bloqueio Sankhya.",
                "WARN",
            )
        else:
            log("IP brasileiro confirmado.")

    except Exception as e:
        log(f"Não foi possível checar IP externo: {e}", "WARN")

    return result


# ── Info do ambiente ──────────────────────────────────────────────────────────

def check_environment() -> None:
    log_sep("AMBIENTE")
    log(f"Python        : {sys.version.split()[0]}")
    log(f"Plataforma    : {sys.platform}")
    log(f"OS name       : {os.name}")
    log(f"DISPLAY       : {os.environ.get('DISPLAY', '(não definido)')}")
    log(f"Headless      : sempre True neste script")
    log(f"Timeout       : {TIMEOUT_MS}ms")
    log(f"Proxy         : {PROXY.split('@')[-1] if PROXY else '(nenhum)'}")
    log(f"URL empresa   : {EXP_URL or '(não fornecida)'}")
    log(f"Screenshots   : {SS_DIR.resolve()}")
    log(f"Usuário       : {USUARIO or '(não definido — set TEST_EXP_USUARIO)'}")
    log(f"Senha         : {'***' if SENHA else '(não definida — set TEST_EXP_SENHA)'}")

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            version = browser.version
            browser.close()
        log(f"Chromium      : {version}")
    except Exception as e:
        log(f"Playwright    : ERRO ao verificar versão — {e}", "ERROR")


# ── Anti-detecção (igual ao sankhya.py de produção) ──────────────────────────

_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
const pluginArr = [1,2,3,4,5];
pluginArr.item = (i) => pluginArr[i] || null;
pluginArr.namedItem = () => null;
pluginArr.refresh = () => {};
Object.defineProperty(navigator, 'plugins',   { get: () => pluginArr });
Object.defineProperty(navigator, 'mimeTypes', { get: () => [1,2] });
Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en-US','en'] });
Object.defineProperty(navigator, 'language',  { get: () => 'pt-BR' });
Object.defineProperty(navigator, 'platform',  { get: () => 'Linux x86_64' });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
Object.defineProperty(navigator, 'connection', {
  get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false })
});
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Google Chrome', version: '139' },
      { brand: 'Chromium', version: '139' },
      { brand: 'Not_A Brand', version: '99' }
    ],
    mobile: false,
    platform: 'Linux',
    getHighEntropyValues: async () => ({
      architecture: 'x86', bitness: '64', mobile: false, model: '',
      platform: 'Linux', platformVersion: '6.1.0', uaFullVersion: '139.0.0.0',
      wow64: false,
      brands: [
        { brand: 'Google Chrome', version: '139' },
        { brand: 'Chromium', version: '139' },
        { brand: 'Not_A Brand', version: '99' }
      ],
    })
  })
});
window.chrome = {
  runtime: {
    connect: () => ({}), sendMessage: () => {},
    onMessage: { addListener: () => {}, removeListener: () => {} },
    id: undefined
  },
  loadTimes: () => ({}), csi: () => ({}), app: {}
};
try {
  const orig = window.navigator.permissions.query.bind(navigator.permissions);
  window.navigator.permissions.query = (p) =>
    p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : orig(p);
} catch(_) {}
try {
  const patchGL = (GL) => {
    const o = GL.prototype.getParameter;
    GL.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return o.apply(this, [p]);
    };
  };
  patchGL(WebGLRenderingContext);
  if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext);
} catch(_) {}
"""

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/139.0.0.0 Safari/537.36"
)

_BASE_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--no-first-run",
    "--no-zygote",
    "--lang=pt-BR",
]

# ── Seletores (espelho dos do sankhya.py) ────────────────────────────────────

_USER_SEL = (
    "#user", "input[name='user']", "input[autocomplete='user']",
    "input[name='username']", "input[name='email']", "input[type='email']",
    "input[autocomplete='username']", "input[id*='user']",
    "input[name*='user']", "input[id*='login']", "input[name*='login']",
)
_PASS_SEL = (
    "#password", "input[type='password']", "input[name='password']",
    "input[id*='pass']", "input[name*='pass']",
    "input[autocomplete='current-password']",
)
_NEXT_SEL = (
    "button:has-text('Prosseguir')", "button.account-btn",
    "button:has-text('Continuar')", "button:has-text('Avancar')",
    "button:has-text('Proximo')",
)
_SUBMIT_SEL = (
    "button:has-text('Prosseguir')", "button:has-text('Entrar')",
    "button:has-text('Acessar')", "button:has-text('Login')",
    "button:has-text('Continuar')", "button.account-btn",
    "button[type='submit']", "input[type='submit']",
)
_GESTAO_SEL = (
    "button:has-text('Novo')",
    "span.checkbox-activity",
    "div.process-check:has-text('Atendimento Avulso')",
)

# ── Helpers de página ────────────────────────────────────────────────────────

def _current_url(page) -> str:
    try:
        return page.url
    except Exception:
        return "?"


def _first_visible(page, selectors, timeout_ms: int):
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        for sel in selectors:
            loc = page.locator(sel).first
            try:
                if loc.count() > 0 and loc.is_visible():
                    return loc
            except Exception:
                continue
        page.wait_for_timeout(250)
    return None


def _capturar_texto_tela(page) -> str:
    selectors = (
        ".swal2-title", ".swal2-html-container", ".swal2-popup",
        ".p-error", ".ant-form-item-explain-error",
        "[role='alert']", ".toast-message",
    )
    partes = []
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            if loc.count() > 0 and loc.is_visible():
                texto = " ".join(loc.inner_text(timeout=1000).split())
                if texto:
                    partes.append(f"[{sel}] {texto[:200]}")
        except Exception:
            continue
    return " | ".join(partes) if partes else ""


def _pede_login(page) -> bool:
    url = (_current_url(page) or "").lower()
    if any(t in url for t in ("login", "signin", "auth")):
        return True
    for sel in _PASS_SEL + _USER_SEL[:3]:
        loc = page.locator(sel).first
        try:
            if loc.count() > 0 and loc.is_visible():
                return True
        except Exception:
            continue
    return False


def _log_estado_pagina(page, etapa: str) -> None:
    url = _current_url(page)
    feedback = _capturar_texto_tela(page)
    pede_login = _pede_login(page)
    log(f"[{etapa}] URL: {url}")
    if feedback:
        log(f"[{etapa}] Tela diz: {feedback}")
    log(f"[{etapa}] Pede login: {pede_login}")


def _log_cookies(page, etapa: str) -> None:
    try:
        cookies = page.context.cookies()
        nomes = [c["name"] for c in cookies]
        log(f"[{etapa}] Cookies ({len(cookies)}): {', '.join(nomes[:15])}")
        sankhya_cookies = [c for c in cookies if "sankhya" in c.get("domain", "").lower()]
        if sankhya_cookies:
            for c in sankhya_cookies:
                log(f"[{etapa}]   Cookie Sankhya: {c['name']} @ {c['domain']} "
                    f"(httpOnly={c.get('httpOnly',False)}, secure={c.get('secure',False)})")
    except Exception as e:
        log(f"[{etapa}] Não foi possível ler cookies: {e}", "WARN")


def _log_local_storage(page, etapa: str) -> None:
    try:
        keys = page.evaluate(
            "() => { try { return Object.keys(localStorage); } catch(e) { return []; } }"
        )
        log(f"[{etapa}] localStorage keys ({len(keys)}): {', '.join(keys[:20])}")
    except Exception as e:
        log(f"[{etapa}] localStorage inacessível: {e}", "WARN")


def _digitar_humanizado(page, locator, valor: str, campo: str, delay_ms: int = 80) -> None:
    locator.wait_for(state="visible", timeout=5000)
    locator.click()
    page.wait_for_timeout(300)
    locator.press("Control+A")
    locator.press("Backspace")
    page.wait_for_timeout(200)
    page.keyboard.type(valor, delay=delay_ms)
    page.wait_for_timeout(300)

    try:
        atual = locator.input_value()
    except Exception:
        atual = ""

    if atual == valor:
        log(f"Campo '{campo}' preenchido ({len(atual)} chars via keyboard.type).")
    else:
        log(f"[WARN] Campo '{campo}' typing falhou ({len(atual)}/{len(valor)}) — usando fill.", "WARN")
        locator.fill(valor)


# ── Monitoramento de rede ─────────────────────────────────────────────────────

_NET_EVENTS: list[dict] = []

def _attach_network_monitor(page) -> None:
    def on_request(req):
        url = req.url
        if any(domain in url for domain in ("sankhya", "login.sankhya", "experience.sankhya")):
            _NET_EVENTS.append({"type": "REQ", "method": req.method, "url": url})
            log(f"[NET >>>] {req.method} {url[:120]}")

    def on_response(resp):
        url = resp.url
        if any(domain in url for domain in ("sankhya", "login.sankhya", "experience.sankhya")):
            status = resp.status
            _NET_EVENTS.append({"type": "RES", "status": status, "url": url})
            nivel = "WARN" if status >= 400 else "INFO"
            log(f"[NET <<<] {status} {url[:120]}", nivel)

    def on_response_failed(req):
        url = req.url
        if any(domain in url for domain in ("sankhya", "login.sankhya", "experience.sankhya")):
            log(f"[NET ERR] FALHOU {url[:120]}", "ERROR")

    page.on("request",         on_request)
    page.on("response",        on_response)
    page.on("requestfailed",   on_response_failed)
    page.on("console",         lambda m: log(f"[Browser {m.type.upper()}] {m.text}"))
    page.on("pageerror",       lambda e: log(f"[Browser PAGEERR] {e}", "ERROR"))


# ── Fluxo de login ────────────────────────────────────────────────────────────

def executar_teste(page) -> bool:
    fator = 2  # sempre servidor — sem display

    # ── 1. Abrir URL de login ─────────────────────────────────────────────────
    log_sep("PASSO 1 — Navegar para login Sankhya")
    log(f"URL alvo: {LOGIN_URL}")
    try:
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        page.wait_for_timeout(int(3000 * fator))
    except Exception as e:
        log(f"goto() falhou: {e}", "WARN")
        log("Tentando prosseguir com o que carregou...")

    _log_estado_pagina(page, "pos-goto")
    screenshot(page, "01_pos_goto")

    # ── 2. Campo de usuário ───────────────────────────────────────────────────
    log_sep("PASSO 2 — Campo de e-mail")
    campo_usuario = _first_visible(page, _USER_SEL, int(15000 * fator))
    if not campo_usuario:
        _log_estado_pagina(page, "sem-campo-email")
        screenshot(page, "02_sem_campo_email")
        log("FALHA: campo de usuário não apareceu.", "ERROR")
        return False

    log(f"Campo de e-mail encontrado. Digitando ({len(USUARIO)} chars)...")
    _digitar_humanizado(page, campo_usuario, USUARIO, "usuario")
    page.wait_for_timeout(int(800 * fator))
    _log_estado_pagina(page, "pos-digitar-email")
    screenshot(page, "02_email_digitado")

    # ── 3. Avançar para senha ─────────────────────────────────────────────────
    log_sep("PASSO 3 — Avançar para tela de senha")
    if not _first_visible(page, _PASS_SEL, 2000):
        log("Senha não visível ainda — procurando botão Prosseguir...")
        loc_next = _first_visible(page, _NEXT_SEL, 5000)
        if loc_next:
            log("Botão Prosseguir encontrado. Clicando...")
            loc_next.click()
        else:
            log("Prosseguir não encontrado — pressionando Enter no campo email.", "WARN")
            try:
                campo_usuario.press("Enter")
            except Exception:
                pass

        page.wait_for_timeout(int(4000 * fator))
        feedback = _capturar_texto_tela(page)
        if feedback:
            log(f"Mensagem após Prosseguir: {feedback}")
        _log_estado_pagina(page, "pos-prosseguir")
        screenshot(page, "03_pos_prosseguir")

    # ── 4. Campo de senha ─────────────────────────────────────────────────────
    log_sep("PASSO 4 — Campo de senha")
    campo_senha = _first_visible(page, _PASS_SEL, int(TIMEOUT_MS * fator))
    if not campo_senha:
        _log_estado_pagina(page, "sem-campo-senha")
        screenshot(page, "04_sem_campo_senha")
        log("FALHA: campo de senha não apareceu após Prosseguir.", "ERROR")
        return False

    log(f"Campo de senha encontrado. Digitando ({len(SENHA)} chars)...")
    _digitar_humanizado(page, campo_senha, SENHA, "senha", delay_ms=60)
    page.wait_for_timeout(int(1200 * fator))
    screenshot(page, "04_senha_digitada")

    # ── 5. Submit ─────────────────────────────────────────────────────────────
    log_sep("PASSO 5 — Submit")
    loc_submit = _first_visible(page, _SUBMIT_SEL, 5000)
    if loc_submit:
        log("Botão submit encontrado. Clicando...")
        loc_submit.click()
    else:
        log("Submit não encontrado — pressionando Enter no campo senha.", "WARN")
        try:
            campo_senha.press("Enter")
        except Exception:
            pass

    screenshot(page, "05_pos_submit")

    # ── 6. Aguardar sair da tela de login ─────────────────────────────────────
    log_sep("PASSO 6 — Aguardando conclusão do login")
    deadline = time.monotonic() + (TIMEOUT_MS / 1000) * fator
    fora_login_desde: float | None = None
    estabilizacao = 10

    while time.monotonic() < deadline:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=1000)
        except Exception:
            pass

        url_atual = _current_url(page)
        feedback = _capturar_texto_tela(page)
        if feedback:
            log(f"Feedback de tela: {feedback}")

        if not _pede_login(page):
            if fora_login_desde is None:
                fora_login_desde = time.monotonic()
                log(f"Saiu da tela de login. Aguardando {estabilizacao}s para estabilizar...")
                screenshot(page, "06_saiu_login")
            elif time.monotonic() - fora_login_desde >= estabilizacao:
                log("Login estabilizado fora da tela de autenticação.")
                break
        else:
            if fora_login_desde is not None:
                log("Voltou para tela de login durante estabilização.", "WARN")
            fora_login_desde = None

        page.wait_for_timeout(500)
    else:
        _log_estado_pagina(page, "timeout-login")
        screenshot(page, "06_timeout_login")
        log("FALHA: login não concluiu no tempo esperado.", "ERROR")
        return False

    _log_estado_pagina(page, "login-concluido")
    _log_cookies(page, "pos-login")
    _log_local_storage(page, "pos-login")
    screenshot(page, "07_login_concluido")

    # ── 7. Navegar para URL da empresa (opcional) ─────────────────────────────
    if EXP_URL:
        log_sep("PASSO 7 — Navegar para URL da empresa")
        log(f"URL empresa: {EXP_URL}")
        try:
            page.goto(EXP_URL, wait_until="commit", timeout=TIMEOUT_MS)
            page.wait_for_timeout(int(3000 * fator))
        except Exception as e:
            log(f"goto empresa falhou: {e}", "WARN")

        _log_estado_pagina(page, "pos-nav-empresa")
        screenshot(page, "08_empresa_carregada")

        if _pede_login(page):
            log("AVISO: URL da empresa pediu login novamente após autenticação.", "WARN")
            screenshot(page, "08_empresa_pede_login")
            return False

        # Checar se tela de gestão está disponível
        gestao_encontrada = False
        deadline_g = time.monotonic() + 20
        while time.monotonic() < deadline_g:
            for sel in _GESTAO_SEL:
                loc = page.locator(sel).first
                try:
                    if loc.count() > 0 and loc.is_visible():
                        log(f"Tela de gestão detectada via selector '{sel}'.")
                        gestao_encontrada = True
                        break
                except Exception:
                    continue
            if gestao_encontrada:
                break
            page.wait_for_timeout(500)

        if gestao_encontrada:
            screenshot(page, "09_gestao_ok")
            log("SUCESSO COMPLETO: Login + navegação para empresa + tela de gestão OK.")
        else:
            screenshot(page, "09_sem_gestao")
            log("Login OK, mas tela de gestão não apareceu na URL da empresa.", "WARN")
            _log_estado_pagina(page, "sem-gestao")
    else:
        log("TEST_EXP_URL não fornecida — teste de navegação pós-login pulado.")
        log("Dica: defina TEST_EXP_URL com a URL de etapas de um cliente para teste completo.")

    return True


# ── Relatório de rede ─────────────────────────────────────────────────────────

def report_network() -> None:
    log_sep("RESUMO DE REQUISIÇÕES SANKHYA")
    if not _NET_EVENTS:
        log("Nenhuma requisição Sankhya capturada.")
        return

    erros = [e for e in _NET_EVENTS if e.get("status", 200) >= 400]
    log(f"Total requisições Sankhya : {len(_NET_EVENTS)}")
    log(f"Respostas com erro (4xx/5xx): {len(erros)}")
    if erros:
        log("Detalhes dos erros:")
        for e in erros:
            log(f"  {e['status']} {e['url'][:100]}", "WARN")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    log_sep("TESTE DE LOGIN RPA — SANKHYA EXPERIENCE")
    log(f"Iniciando em {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Checar credenciais antes de qualquer coisa
    if not USUARIO or not SENHA:
        log("ERRO: defina TEST_EXP_USUARIO e TEST_EXP_SENHA antes de executar.", "ERROR")
        log("Exemplo:")
        log("  export TEST_EXP_USUARIO=seuemail@empresa.com")
        log("  export TEST_EXP_SENHA=suasenha")
        return 1

    check_environment()
    ip_info = check_ip()

    from playwright.sync_api import sync_playwright

    sucesso = False
    try:
        with sync_playwright() as p:
            launch_kwargs: dict = {
                "headless": True,
                "args": _BASE_ARGS,
                "ignore_default_args": ["--enable-automation"],
            }
            if PROXY:
                launch_kwargs["proxy"] = {"server": PROXY}
                log(f"Proxy ativo: {PROXY.split('@')[-1]}")

            context = p.chromium.launch_persistent_context(
                user_data_dir=str(SS_DIR / "_profile"),
                user_agent=_USER_AGENT,
                locale="pt-BR",
                timezone_id="America/Sao_Paulo",
                viewport={"width": 1600, "height": 900},
                extra_http_headers={
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "sec-ch-ua": '"Google Chrome";v="139", "Chromium";v="139", "Not_A Brand";v="99"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"Linux"',
                },
                **launch_kwargs,
            )

            context.add_init_script(_INIT_SCRIPT)

            page = context.pages[0] if context.pages else context.new_page()
            for extra in context.pages[1:]:
                try:
                    extra.close()
                except Exception:
                    pass

            page.set_default_timeout(TIMEOUT_MS)
            page.set_default_navigation_timeout(TIMEOUT_MS)
            _attach_network_monitor(page)

            log("Browser Chromium iniciado (headless=True).")
            log_sep("INICIANDO FLUXO DE LOGIN")

            sucesso = executar_teste(page)

            context.close()

    except Exception as exc:
        log(f"ERRO CRÍTICO: {exc}", "ERROR")
        traceback.print_exc()
        sucesso = False

    report_network()

    log_sep("RESULTADO FINAL")
    if sucesso:
        log("RESULTADO: LOGIN BEM-SUCEDIDO")
        if ip_info["country"] != "BR" and ip_info["country"] != "?":
            log(
                f"OBSERVAÇÃO: Login funcionou com IP {ip_info['country']} "
                "— o Sankhya não está bloqueando por país neste momento.",
                "WARN",
            )
    else:
        log("RESULTADO: LOGIN FALHOU", "ERROR")
        if ip_info["country"] not in ("BR", "?"):
            log(
                f"DIAGNÓSTICO PROVÁVEL: IP {ip_info['country']} bloqueado pelo Sankhya. "
                "Configure TEST_PROXY com um proxy residencial brasileiro.",
                "ERROR",
            )
        else:
            log(
                "IP é brasileiro — o problema pode ser credenciais, "
                "timeout ou mudança no fluxo de login do Sankhya.",
                "WARN",
            )

    log(f"Screenshots em: {SS_DIR.resolve()}")
    log(f"Tempo total: {time.monotonic() - _START:.1f}s")

    return 0 if sucesso else 1


if __name__ == "__main__":
    sys.exit(main())
