# -*- coding: utf-8 -*-
import os
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

_LOGIN_URL = "https://login.sankhya.com.br/?redirect_to=https://experience.sankhya.com.br/projeto&application_id=6"
_LOCAL_PROFILE = str(Path(__file__).resolve().parents[2] / "runtime" / "sankhya_profile")


# ======================================================
# UTIL — IDENTIFICAR SE DESCRIÇÃO É SUSTENTAÇÃO
# ======================================================
def descricao_eh_sustentacao(texto: str):
    if not texto:
        return False
    texto = texto.lower()
    palavras_chave = [
        "contrato de sustentação",
        "contrato sustentacao",
        "manutenção da sustentação",
        "manutencao da sustentacao",
        "sustentação",
        "sustentacao",
    ]
    return any(p in texto for p in palavras_chave)


# ======================================================
# AMBIENTE
# ======================================================
def _is_server() -> bool:
    return (os.name != "nt") and not os.environ.get("DISPLAY")


def _pagina_pede_login(page) -> bool:
    url = getattr(page, "url", "") or ""
    return any(t in url for t in ("login.sankhya.com.br", "signin", "auth"))


# ======================================================
# LOGIN
# ======================================================
def _executar_login(page, usuario: str, senha: str) -> None:
    em_servidor = _is_server()
    fator = 2 if em_servidor else 1

    print(f"  [login] Navegando para {_LOGIN_URL} ...", flush=True)
    page.goto(_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(int(3000 * fator))

    # Email
    email_sel = "input[type='email'], input[name='email'], input[autocomplete='email']"
    page.wait_for_selector(email_sel, timeout=30000)
    campo_email = page.locator(email_sel).first
    campo_email.click()
    page.wait_for_timeout(300)
    campo_email.press("Control+A")
    campo_email.press("Backspace")
    page.keyboard.type(usuario, delay=80)
    page.wait_for_timeout(int(1000 * fator))

    # Prosseguir (se a senha ainda nao apareceu)
    if page.locator("input[type='password']").count() == 0:
        page.get_by_role("button", name="Prosseguir").click()
        page.wait_for_timeout(int(3000 * fator))

    # Senha
    page.wait_for_selector("input[type='password']", timeout=30000)
    campo_senha = page.locator("input[type='password']").first
    campo_senha.click()
    page.wait_for_timeout(300)
    page.keyboard.type(senha, delay=80)
    page.wait_for_timeout(500)

    page.get_by_role("button", name="Entrar").click()
    print("  [login] Aguardando redirecionamento...", flush=True)

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if not _pagina_pede_login(page):
            break
        page.wait_for_timeout(500)

    page.wait_for_timeout(int(5000 * fator))
    print(f"  [login] OK — URL: {page.url}", flush=True)


# ======================================================
# CONTEXTO DO BROWSER
# ======================================================
def _abrir_contexto(p):
    is_server = _is_server()
    if is_server:
        tmp_dir = tempfile.mkdtemp(prefix="saldoh_profile_")
        context = p.chromium.launch_persistent_context(
            user_data_dir=tmp_dir,
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-setuid-sandbox",
                "--disable-software-rasterizer",
            ],
        )
        return context, tmp_dir
    else:
        context = p.chromium.launch_persistent_context(
            user_data_dir=_LOCAL_PROFILE,
            headless=False,
            args=["--start-maximized"],
            no_viewport=True,
        )
        return context, None


# ======================================================
# EXTRAÇÃO DE SALDO (REUTILIZA PAGE)
# ======================================================
def extrair_saldo_de_page(page, url_pedido: str, empresa: str = ""):
    resultado = {
        "codigo": None,
        "hrs_alocadas": None,
        "hrs_consumidas": None,
        "saldo_horas": None,
        "tipo_operacao": None,
        "tipo": None,
        "data_mais_recente": None,
    }

    INDICE_DATA = 10
    label = f"[{empresa}]" if empresa else "[?]"

    print(f"\n{'='*55}", flush=True)
    print(f"  {label} Iniciando consulta...", flush=True)
    print(f"  URL: {url_pedido}", flush=True)
    print(f"{'='*55}", flush=True)

    page.goto(url_pedido, timeout=60000)

    # Se caiu no login, autentica e volta
    if _pagina_pede_login(page):
        print(f"  {label} Redirecionado para login.", flush=True)
        usuario = os.environ.get("EXP_USUARIO", "").strip()
        senha = os.environ.get("EXP_SENHA", "").strip()
        if not usuario or not senha:
            raise RuntimeError(
                "Credenciais nao configuradas. Defina EXP_USUARIO e EXP_SENHA como secrets no Fly.io."
            )
        _executar_login(page, usuario, senha)
        print(f"  {label} Navegando para URL apos login...", flush=True)
        page.goto(url_pedido, timeout=60000)

    page.wait_for_load_state("networkidle", timeout=30000)
    print(f"  {label} Pagina carregada.", flush=True)

    print(f"  {label} Aplicando filtro...", flush=True)
    page.locator("#filtrar-button").click()
    page.wait_for_selector("tbody tr", timeout=15000)
    print(f"  {label} Filtro aplicado.", flush=True)

    print(f"  {label} Selecionando 100 registros por pagina...", flush=True)
    dropdown = page.locator("div.p-dropdown").last
    dropdown.click()
    page.wait_for_selector("li[role='option']", timeout=10000)
    page.locator("li[role='option']", has_text="100").click()

    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_selector("tbody tr", timeout=15000)
    time.sleep(1.5)

    linhas = page.locator("tbody tr")
    total = linhas.count()
    print(f"  {label} Grid carregada — {total} linha(s) encontrada(s).", flush=True)

    pedidos = []

    for i in range(total):
        linha = linhas.nth(i)
        colunas = linha.locator("td")

        if colunas.count() <= INDICE_DATA:
            continue

        data_texto = colunas.nth(INDICE_DATA).inner_text().strip()

        try:
            data_obj = datetime.strptime(data_texto, "%d/%m/%Y")
        except Exception:
            continue

        codigo = colunas.nth(0).inner_text().strip()
        hrs_alocadas = colunas.nth(1).inner_text().strip()
        hrs_consumidas = colunas.nth(2).inner_text().strip()
        saldo_horas = colunas.nth(3).inner_text().strip()
        tipo_operacao = colunas.nth(4).inner_text().strip()
        tipo = colunas.nth(7).inner_text().strip()

        descricao = ""
        try:
            span = colunas.nth(9).locator("span[title]").first
            descricao = span.get_attribute("title") or ""
        except Exception:
            pass

        pedidos.append({
            "data": data_obj,
            "codigo": codigo,
            "hrs_alocadas": hrs_alocadas,
            "hrs_consumidas": hrs_consumidas,
            "saldo_horas": saldo_horas,
            "tipo_operacao": tipo_operacao,
            "tipo": tipo,
            "descricao": descricao,
            "data_texto": data_texto,
        })

    print(f"  {label} {len(pedidos)} pedido(s) valido(s) processado(s).", flush=True)

    if not pedidos:
        print(f"  {label} Nenhum pedido encontrado. Retornando vazio.", flush=True)
        return resultado

    # Priorização
    medicoes = [p for p in pedidos if p["tipo"].lower() == "medição"]

    if medicoes:
        pedido_escolhido = max(medicoes, key=lambda x: x["data"])
        print(f"  {label} Tipo selecionado: Medicao", flush=True)
    else:
        empreitos_sust = [
            p for p in pedidos
            if p["tipo"].lower() == "empreito"
            and descricao_eh_sustentacao(p["descricao"])
        ]
        if empreitos_sust:
            pedido_escolhido = max(empreitos_sust, key=lambda x: x["data"])
            print(f"  {label} Tipo selecionado: Empreito (Sustentacao)", flush=True)
        else:
            pedido_escolhido = max(pedidos, key=lambda x: x["data"])
            print(f"  {label} Tipo selecionado: Fallback (mais recente)", flush=True)

    print(
        f"  {label} Pedido escolhido: #{pedido_escolhido['codigo']} "
        f"| Data: {pedido_escolhido['data_texto']} "
        f"| Saldo: {pedido_escolhido['saldo_horas']}",
        flush=True,
    )

    return {
        "codigo": pedido_escolhido["codigo"],
        "hrs_alocadas": pedido_escolhido["hrs_alocadas"],
        "hrs_consumidas": pedido_escolhido["hrs_consumidas"],
        "saldo_horas": pedido_escolhido["saldo_horas"],
        "tipo_operacao": pedido_escolhido["tipo_operacao"],
        "tipo": pedido_escolhido["tipo"],
        "data_mais_recente": pedido_escolhido["data_texto"],
    }


# ======================================================
# FUNÇÃO INDIVIDUAL
# ======================================================
def extrair_saldo_fap(url_pedido: str):
    tmp_dir = None
    try:
        with sync_playwright() as p:
            context, tmp_dir = _abrir_contexto(p)
            page = context.new_page()
            resultado = extrair_saldo_de_page(page, url_pedido)
            context.close()
            return resultado
    except Exception as e:
        print(f"  Erro individual: {str(e)}", flush=True)
        traceback.print_exc()
        return {}
    finally:
        if tmp_dir:
            try:
                import shutil
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass


# ======================================================
# FUNÇÃO MÚLTIPLA
# ======================================================
def extrair_saldo_fap_multiplo(lista_urls: list):
    resultados = {}
    total_empresas = len(lista_urls)
    tmp_dir = None

    print(f"\n{'#'*55}", flush=True)
    print(f"  INICIANDO CONSULTA MULTIPLA — {total_empresas} empresa(s)", flush=True)
    print(f"{'#'*55}", flush=True)

    try:
        with sync_playwright() as p:
            context, tmp_dir = _abrir_contexto(p)
            page = context.new_page()

            # Login antecipado se for servidor (evita login por empresa)
            if _is_server():
                usuario = os.environ.get("EXP_USUARIO", "").strip()
                senha = os.environ.get("EXP_SENHA", "").strip()
                if usuario and senha:
                    print("  Fazendo login antecipado no Sankhya...", flush=True)
                    _executar_login(page, usuario, senha)

            for idx, item in enumerate(lista_urls, start=1):
                empresa = item["empresa"]
                url = item["url"]

                print(f"\n  [{idx}/{total_empresas}] Abrindo empresa: {empresa}", flush=True)

                try:
                    resultado = extrair_saldo_de_page(page, url, empresa=empresa)
                    resultado["ultima_atualizacao"] = datetime.now().isoformat()
                    resultados[empresa] = resultado
                except Exception as e:
                    print(f"  [{empresa}] Erro: {str(e)}", flush=True)
                    traceback.print_exc()
                    resultados[empresa] = {"erro": str(e)}

            context.close()

    except Exception as e:
        print(f"\n  Erro geral no contexto: {str(e)}", flush=True)
        traceback.print_exc()
    finally:
        if tmp_dir:
            try:
                import shutil
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    print(f"\n{'#'*55}", flush=True)
    print(
        f"  CONSULTA FINALIZADA — {len(resultados)}/{total_empresas} empresa(s) processada(s)",
        flush=True,
    )
    print(f"{'#'*55}\n", flush=True)

    return resultados
