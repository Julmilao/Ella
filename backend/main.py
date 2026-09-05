from __future__ import annotations

# Carrega variáveis do .env antes de qualquer import que use os.environ
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import asyncio
import copy
import io
import json
import logging
import os
import sys
import time
from threading import RLock
from uuid import uuid4

from fastapi import BackgroundTasks, Body, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.oauth2 import service_account
from googleapiclient.discovery import build

from core.auth import extract_bearer_token, require_auth, require_module_access, revoke_session
from core.automacao.abertura_os import executar_abertura_os
from core.automacao.apontamento_tarefa import executar_fluxo_apontamento
from core.automacao.saldoh import extrair_saldo_fap, extrair_saldo_fap_multiplo
from core.db import get_db
from core.env import get_cors_allow_origins, get_env, get_required_env, load_local_env, resolve_path
from core.timezone_utils import BRASILIA_TZ_NAME, agora_brasilia
from routers import clientes, status_report, modelos, usuarios, configuracoes
from scheduler import runner as scheduler_runner

load_local_env()


def _preload_sheets():
    """Pré-carrega abas e aba atual do Google Sheets no cache ao iniciar."""
    try:
        logger.info("Preload: buscando abas do Google Sheets...")
        sheet = get_sheets_service()
        meta = sheet.get(
            spreadsheetId=SPREADSHEET_ID,
            fields="sheets(properties(title))",
        ).execute()
        abas = [reparar_texto_mojibake(s["properties"]["title"]) for s in meta["sheets"]]
        salvar_abas_cache(abas)
        logger.info("Preload: %d aba(s) cacheada(s): %s", len(abas), abas)

        aba_alvo = NOME_ABA if NOME_ABA in abas else abas[0]
        logger.info("Preload: lendo dados da aba '%s'...", aba_alvo)
        dados = ler_planilha_api(aba_alvo)
        salvar_os_cache(aba_alvo, dados)
        logger.info("Preload: %d linha(s) cacheada(s) da aba '%s'.", len(dados), aba_alvo)
    except Exception:
        logger.exception("Preload falhou — servidor continua normalmente.")


def _marcar_automacoes_interrompidas():
    """Marca execucoes em aberto quando o servidor reinicia no meio do RPA."""
    try:
        db = get_db()
        resposta = (
            db.table("logs")
            .select("execucao_id,mensagem,tipo,usuario_id,criado_em")
            .eq("modulo", "automacao_os")
            .order("criado_em", desc=True)
            .limit(300)
            .execute()
        )
        registros = list(reversed(resposta.data or []))
        execucoes: dict[str, dict] = {}

        for registro in registros:
            execucao_id = registro.get("execucao_id")
            if not execucao_id:
                continue

            mensagem = str(registro.get("mensagem") or "")
            tipo = str(registro.get("tipo") or "")
            item = execucoes.setdefault(
                execucao_id,
                {
                    "iniciou": False,
                    "finalizou": False,
                    "usuario_id": registro.get("usuario_id"),
                },
            )

            if registro.get("usuario_id"):
                item["usuario_id"] = registro.get("usuario_id")

            if (
                "Execucao recebida" in mensagem
                or "Iniciando abertura automatica de OS" in mensagem
            ):
                item["iniciou"] = True

            if (
                "Execucao finalizada" in mensagem
                or "Execução finalizada" in mensagem
                or "Execucao interrompida" in mensagem
                or "Execução interrompida" in mensagem
                or "Erro interno durante execucao" in mensagem
                or tipo == "sucesso"
            ):
                item["finalizou"] = True

        for execucao_id, item in execucoes.items():
            if item["iniciou"] and not item["finalizou"]:
                registrar_log_automacao(
                    "erro",
                    "Execucao interrompida por reinicio do servidor antes de finalizar.",
                    execucao_id,
                    item.get("usuario_id"),
                    detalhe=(
                        "O Render reiniciou o processo enquanto a automacao estava em andamento. "
                        "A execucao foi encerrada e precisa ser disparada novamente."
                    ),
                )
                logger.warning("Execucao %s marcada como interrompida no startup.", execucao_id)
    except Exception:
        logger.exception("Nao foi possivel marcar automacoes interrompidas no startup.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _preload_sheets)
    loop.run_in_executor(None, _marcar_automacoes_interrompidas)
    scheduler_runner.start()
    yield
    scheduler_runner.stop()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(clientes.router)
app.include_router(status_report.router)
app.include_router(modelos.router)
app.include_router(usuarios.router)
app.include_router(configuracoes.router)


# ── Scheduler endpoints ────────────────────────────────────────────────────────

@app.get("/health")
def healthcheck():
    return {"status": "ok"}


_RODAPE_EMAIL = """
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#aaa;font-size:11px;text-align:center">
    Este é um email automático — <strong>não responda a esta mensagem</strong>.<br>
    ELLA SO · Sistema Operacional Interno
  </p>
"""

@app.post("/auth/esqueci-senha")
def esqueci_senha(payload: dict = Body(...)):
    """Endpoint público. Gera nova senha e envia por email se o endereço existir."""
    import secrets as _secrets
    import string as _string
    from scheduler.email_sender import send_email as _send_email

    email = str(payload.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email obrigatorio.")

    db = get_db()

    try:
        res = (
            db.table("profiles")
            .select("user_id, nome, email")
            .eq("email", email)
            .maybe_single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Erro ao consultar usuário. Tente novamente.")

    perfil = res.data if res and res.data else None
    if not perfil:
        raise HTTPException(status_code=404, detail="Nenhuma conta encontrada com este email.")

    # Gerar senha com todos os requisitos
    especiais = "!@#$%&*"
    alfabeto = _string.ascii_letters + _string.digits + especiais
    while True:
        nova_senha = "".join(_secrets.choice(alfabeto) for _ in range(12))
        if (
            any(c.isupper() for c in nova_senha)
            and any(c.islower() for c in nova_senha)
            and any(c.isdigit() for c in nova_senha)
            and any(c in especiais for c in nova_senha)
        ):
            break

    try:
        db.auth.admin.update_user_by_id(perfil["user_id"], {"password": nova_senha})
    except Exception:
        logger.exception("esqueci_senha: falha ao redefinir senha para %s", email)
        raise HTTPException(status_code=500, detail="Erro ao redefinir senha. Tente novamente.")

    try:
        smtp_res = db.table("configuracoes_gerais").select("*").limit(1).execute()
        smtp_config = smtp_res.data[0] if smtp_res.data else {}
        if smtp_config.get("smtp_host"):
            nome = perfil.get("nome") or email
            corpo = f"""
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
              <h2 style="color:#1a7a4a">Redefinição de senha — ELLA SO</h2>
              <p>Olá, <strong>{nome}</strong>!</p>
              <p>Uma nova senha foi gerada para sua conta:</p>
              <div style="background:#f4f4f4;border-radius:8px;padding:16px 20px;margin:16px 0">
                <p style="margin:4px 0"><strong>Email:</strong> {email}</p>
                <p style="margin:4px 0"><strong>Nova senha:</strong>
                  <span style="font-family:monospace;font-size:16px;letter-spacing:2px">{nova_senha}</span>
                </p>
              </div>
              <p style="color:#888;font-size:13px">Se não foi você quem solicitou, ignore este email.</p>
              {_RODAPE_EMAIL}
            </div>
            """
            _send_email(smtp_config, [email], "Sua nova senha — ELLA SO", corpo)
    except Exception as exc:
        logger.warning("esqueci_senha: falha ao enviar email para %s: %s", email, exc)

    # Marcar senha como temporária para forçar troca no próximo login
    try:
        db.table("profiles").update({"senha_temporaria": True}).eq("user_id", perfil["user_id"]).execute()
    except Exception:
        logger.warning("esqueci_senha: nao foi possivel marcar senha_temporaria para %s", email)

    return {"status": "ok", "message": "Nova senha enviada para o seu email."}


@app.put("/auth/alterar-senha")
def alterar_senha_propria(payload: dict = Body(...), current_user: dict = Depends(require_auth)):
    """Usuário altera sua própria senha. Remove a flag senha_temporaria."""
    nova_senha = str(payload.get("nova_senha", "")).strip()
    confirmar  = str(payload.get("confirmar_senha", "")).strip()

    if len(nova_senha) < 8:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 8 caracteres.")
    if nova_senha != confirmar:
        raise HTTPException(status_code=400, detail="As senhas não coincidem.")

    especiais = "!@#$%&*"
    if not (
        any(c.isupper() for c in nova_senha)
        and any(c.islower() for c in nova_senha)
        and any(c.isdigit() for c in nova_senha)
        and any(c in especiais for c in nova_senha)
    ):
        raise HTTPException(
            status_code=400,
            detail="A senha deve conter pelo menos 1 maiúscula, 1 minúscula, 1 número e 1 caractere especial (!@#$%&*).",
        )

    user_id = current_user["id"]
    db = get_db()

    try:
        db.auth.admin.update_user_by_id(user_id, {"password": nova_senha})
    except Exception:
        logger.exception("alterar_senha: falha ao atualizar senha do usuario %s", user_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar senha. Tente novamente.")

    try:
        db.table("profiles").update({"senha_temporaria": False}).eq("user_id", user_id).execute()
    except Exception:
        logger.warning("alterar_senha: nao foi possivel remover senha_temporaria do usuario %s", user_id)

    return {"status": "ok", "message": "Senha alterada com sucesso."}


@app.post("/scheduler/reload", dependencies=[Depends(require_module_access("admin"))])
def scheduler_reload():
    """
    Recarrega dinamicamente todos os jobs do APScheduler com base nas
    configurações ativas do Supabase. Chame este endpoint sempre que
    criar/editar/remover uma rotina ou modelo.
    """
    result = scheduler_runner.reload_jobs()
    return {"status": "ok", **result}


@app.get("/scheduler/jobs", dependencies=[Depends(require_module_access("admin"))])
def scheduler_jobs():
    """Retorna a lista de jobs atualmente registrados no scheduler."""
    return {"status": "ok", "jobs": scheduler_runner.get_jobs_info()}


@app.get("/system/time")
def system_time():
    """Retorna o horário corrente do backend em Brasília.

    Endpoint público por ser usado apenas para sincronizar o relógio do cabeçalho.
    """
    agora = agora_brasilia()
    return {
        "status": "ok",
        "timezone": BRASILIA_TZ_NAME,
        "current_time": agora.isoformat(),
        "current_time_ms": int(agora.timestamp() * 1000),
    }

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SPREADSHEET_ID = get_required_env("SPREADSHEET_ID")
NOME_ABA = get_env("SHEETS_DEFAULT_TAB", "032026")
NOME_COLUNA_STATUS = get_env("SHEETS_STATUS_COLUMN", "Status experience")
ABAS_CACHE_TTL_SECONDS = 300
OS_CACHE_TTL_SECONDS = 90
SHEETS_BACKOFF_SECONDS = 75
LOCAL_STATE_LOCK = RLock()

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
CLIENTES_FILE = DATA_DIR / "clientes.json"
CACHE_FILE = DATA_DIR / "pedidos_cache.json"
SHEETS_CACHE_FILE = DATA_DIR / "sheets_cache.json"
GOOGLE_SERVICE_ACCOUNT_FILE = get_env("GOOGLE_SERVICE_ACCOUNT_FILE")
CREDENTIALS_FILE = (
    resolve_path(GOOGLE_SERVICE_ACCOUNT_FILE, base_dir=BASE_DIR)
    if GOOGLE_SERVICE_ACCOUNT_FILE
    else DATA_DIR / "google_credentials.json"
)


# ==============================
# Auth
# ==============================
def get_sheets_service(write: bool = False):
    import base64, json as _json

    scope = (
        ["https://www.googleapis.com/auth/spreadsheets"]
        if write
        else ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )

    # Suporte a credenciais via base64 (Fly.io / ambientes sem Secret Files)
    creds_b64 = os.environ.get("GOOGLE_CREDENTIALS_B64", "").strip()
    if creds_b64:
        creds_dict = _json.loads(base64.b64decode(creds_b64).decode("utf-8"))
        creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=scope)
    elif CREDENTIALS_FILE.exists():
        creds = service_account.Credentials.from_service_account_file(str(CREDENTIALS_FILE), scopes=scope)
    else:
        raise RuntimeError(
            "Credenciais do Google nao encontradas. "
            "Configure GOOGLE_CREDENTIALS_B64 (base64 do JSON) ou GOOGLE_SERVICE_ACCOUNT_FILE."
        )

    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return service.spreadsheets()

@app.get("/auth/me")
def auth_me(current_user: dict = Depends(require_auth)):
    return {"status": "ok", "user": current_user}


@app.post("/auth/logout")
def auth_logout(authorization: str | None = Header(default=None), current_user: dict = Depends(require_auth)):
    token = extract_bearer_token(authorization)
    revoke_session(token)
    return {"status": "ok", "message": "Sessao encerrada."}


# ==============================
# Local JSON helpers
# ==============================
def _atomic_write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_path, path)


def _load_json_file(path: Path, default, warning_message: str | None = None):
    with LOCAL_STATE_LOCK:
        if not path.exists():
            return copy.deepcopy(default)

        try:
            with open(path, "r", encoding="utf-8") as f:
                conteudo = f.read().strip()
                if not conteudo:
                    return copy.deepcopy(default)
                return json.loads(conteudo)
        except json.JSONDecodeError:
            if warning_message:
                logger.warning(warning_message)
            _atomic_write_json(path, default)
            return copy.deepcopy(default)


def _save_json_file(path: Path, data):
    with LOCAL_STATE_LOCK:
        _atomic_write_json(path, data)


def reparar_texto_mojibake(value):
    if isinstance(value, str) and any(marker in value for marker in ("Ã", "Â", "â", "ð")):
        try:
            return value.encode("latin-1").decode("utf-8")
        except UnicodeError:
            return value
    return value


def reparar_payload_mojibake(value):
    if isinstance(value, dict):
        return {
            reparar_payload_mojibake(chave): reparar_payload_mojibake(valor)
            for chave, valor in value.items()
        }
    if isinstance(value, list):
        return [reparar_payload_mojibake(item) for item in value]
    return reparar_texto_mojibake(value)


def ler_clientes():
    try:
        res = (
            get_db()
            .table("clientes")
            .select("nome, ativo, configuracoes_clientes(url_abertura_os, url_saldo_horas)")
            .order("nome")
            .execute()
        )

        clientes_db = []
        for row in res.data or []:
            cfg = row.get("configuracoes_clientes") or {}
            if isinstance(cfg, list):
                cfg = cfg[0] if cfg else {}

            nome = str(row.get("nome") or "").strip()
            if not nome:
                continue

            clientes_db.append({
                "empresa": reparar_texto_mojibake(nome),
                "experience_url_etapas": cfg.get("url_abertura_os") or "",
                "experience_url_pedidos": cfg.get("url_saldo_horas") or "",
                "ativo": row.get("ativo", True),
            })

        return {"clientes": clientes_db}
    except Exception:
        logger.exception("Nao foi possivel buscar clientes no Supabase. Usando JSON local.")
        return reparar_payload_mojibake(_load_json_file(CLIENTES_FILE, {"clientes": []}))


def salvar_clientes(dados):
    _save_json_file(CLIENTES_FILE, dados)


def ler_cache():
    return reparar_payload_mojibake(_load_json_file(CACHE_FILE, {}, "Cache corrompido. Resetando arquivo."))


def salvar_cache(dados):
    _save_json_file(CACHE_FILE, dados)


def ler_sheets_cache():
    data_raw = _load_json_file(
        SHEETS_CACHE_FILE,
        {"abas": None, "os": {}, "backoff": {"abas_until": 0, "os_until": {}}},
        "Sheets cache corrompido. Resetando arquivo.",
    )
    data = reparar_payload_mojibake(data_raw)
    if data != data_raw:
        salvar_sheets_cache(data)
    data.setdefault("abas", None)
    data.setdefault("os", {})
    data.setdefault("backoff", {})
    data["backoff"].setdefault("abas_until", 0)
    data["backoff"].setdefault("os_until", {})
    return data


def salvar_sheets_cache(data):
    _save_json_file(SHEETS_CACHE_FILE, data)


def obter_abas_cache(max_age_seconds: int | None = None):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        entry = cache.get("abas")
        if not entry:
            return None

        timestamp = entry.get("timestamp", 0)
        if max_age_seconds is not None and (time.time() - timestamp) > max_age_seconds:
            return None

        return entry.get("data") or None


def salvar_abas_cache(abas: list[str]):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        cache["abas"] = {"timestamp": time.time(), "data": abas}
        salvar_sheets_cache(cache)


def obter_os_cache(aba: str, max_age_seconds: int | None = None):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        entry = cache.get("os", {}).get(aba)
        if not entry:
            return None

        timestamp = entry.get("timestamp", 0)
        if max_age_seconds is not None and (time.time() - timestamp) > max_age_seconds:
            return None

        return entry.get("data")


def salvar_os_cache(aba: str, dados: list[dict]):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        cache.setdefault("os", {})
        cache["os"][aba] = {"timestamp": time.time(), "data": dados}
        salvar_sheets_cache(cache)


def abas_em_backoff() -> bool:
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        until = cache.get("backoff", {}).get("abas_until", 0) or 0
        return until > time.time()


def registrar_backoff_abas(seconds: int = SHEETS_BACKOFF_SECONDS):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        cache.setdefault("backoff", {})
        cache["backoff"]["abas_until"] = time.time() + seconds
        salvar_sheets_cache(cache)


def os_em_backoff(aba: str) -> bool:
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        until = cache.get("backoff", {}).get("os_until", {}).get(aba, 0) or 0
        return until > time.time()


def registrar_backoff_os(aba: str, seconds: int = SHEETS_BACKOFF_SECONDS):
    with LOCAL_STATE_LOCK:
        cache = ler_sheets_cache()
        cache.setdefault("backoff", {})
        cache["backoff"].setdefault("os_until", {})
        cache["backoff"]["os_until"][aba] = time.time() + seconds
        salvar_sheets_cache(cache)


def listar_abas_fallback():
    with LOCAL_STATE_LOCK:
        abas_cache = obter_abas_cache()
        if abas_cache:
            return abas_cache

        cache = ler_sheets_cache()
        abas_os = sorted(cache.get("os", {}).keys())
        if abas_os:
            return abas_os

        return [NOME_ABA]


# ==============================
# Sheets helpers
# ==============================
def ler_planilha_api(nome_aba: str):
    sheet = get_sheets_service()
    result = sheet.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{nome_aba}!A1:Z1000",
    ).execute()

    values = result.get("values", [])
    if not values:
        return []

    headers = [reparar_texto_mojibake(header) for header in values[0]]
    rows = values[1:]
    dados = []

    for index, row in enumerate(rows):
        item = {}
        for i, header in enumerate(headers):
            valor = row[i] if i < len(row) else ""
            item[header] = reparar_texto_mojibake(valor)
        item["linha_id"] = index + 2
        dados.append(item)

    return dados


def buscar_letra_coluna_por_nome(sheet, nome_aba: str, nome_coluna: str) -> str:
    result = sheet.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{nome_aba}!1:1",
    ).execute()

    headers = result.get("values", [[]])[0]

    for i, header in enumerate(headers):
        if header.strip().lower() == nome_coluna.strip().lower():
            col_letra = ""
            n = i + 1
            while n > 0:
                n, remainder = divmod(n - 1, 26)
                col_letra = chr(65 + remainder) + col_letra
            return col_letra

    raise ValueError(
        f"Coluna '{nome_coluna}' nao encontrada na planilha. "
        f"Colunas disponiveis: {headers}"
    )


def atualizar_status_por_linha(nome_aba: str, linha_id: int, novo_status: str = "OS Lançada"):
    sheet = get_sheets_service(write=True)
    letra_coluna = buscar_letra_coluna_por_nome(sheet, nome_aba, NOME_COLUNA_STATUS)
    logger.info("Coluna '%s' encontrada na letra '%s'", NOME_COLUNA_STATUS, letra_coluna)

    sheet.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{nome_aba}!{letra_coluna}{linha_id}",
        valueInputOption="USER_ENTERED",
        body={"values": [[novo_status]]},
    ).execute()


def atualizar_obs_por_linha(nome_aba: str, linha_id: int, mensagem: str) -> None:
    sheet = get_sheets_service(write=True)
    letra_coluna = buscar_letra_coluna_por_nome(sheet, nome_aba, "OBS")
    range_celula = f"{nome_aba}!{letra_coluna}{linha_id}"

    atual = sheet.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=range_celula,
    ).execute()
    valores_atuais = atual.get("values", [])
    conteudo_atual = valores_atuais[0][0] if valores_atuais and valores_atuais[0] else ""

    novo_conteudo = f"{conteudo_atual} | {mensagem}" if conteudo_atual else mensagem

    sheet.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=range_celula,
        valueInputOption="USER_ENTERED",
        body={"values": [[novo_conteudo]]},
    ).execute()


def registrar_log_automacao(
    tipo: str,
    mensagem: str,
    execucao_id: str | None,
    usuario_id: str | None,
    detalhe: str | None = None,
) -> None:
    try:
        payload = {
            "modulo": "automacao_os",
            "tipo": tipo,
            "mensagem": mensagem,
        }
        if execucao_id:
            payload["execucao_id"] = execucao_id
        if usuario_id:
            payload["usuario_id"] = usuario_id
        if detalhe:
            payload["detalhe"] = detalhe
        get_db().table("logs").insert(payload).execute()
    except Exception:
        logger.exception("Nao foi possivel registrar log da automacao.")


# ── Captura de logs em tempo real por execução ───────────────────────────────
_exec_store: dict[str, dict] = {}
_EXEC_STORE_MAX = 20


class _ExecLogWriter:
    """Redireciona sys.stdout para capturar prints linha a linha por execução."""

    def __init__(self, exec_id: str, original: io.TextIOWrapper) -> None:
        self._id = exec_id
        self._original = original
        self._buf = ""

    def write(self, text: str) -> int:
        self._original.write(text)
        self._original.flush()
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            stripped = line.strip()
            if stripped and self._id in _exec_store:
                _exec_store[self._id]["logs"].append(stripped)
        return len(text)

    def flush(self) -> None:
        self._original.flush()

    def fileno(self) -> int:
        return self._original.fileno()


def executar_automacao_em_background(
    itens: list,
    execucao_id: str,
    usuario_id: str | None,
    usuario_email: str,
) -> None:
    _exec_store[execucao_id] = {"logs": [], "status": "running", "resultado": None}
    if len(_exec_store) > _EXEC_STORE_MAX:
        for k in list(_exec_store.keys())[:-_EXEC_STORE_MAX]:
            _exec_store.pop(k, None)

    original_stdout = sys.stdout
    sys.stdout = _ExecLogWriter(execucao_id, original_stdout)
    try:
        logger.info("Execucao de automacao iniciada por %s", usuario_email)
        resultado = executar_abertura_os(
            itens,
            execucao_id=execucao_id,
            usuario_id=usuario_id,
            origem="manual",
        )

        for os_item in resultado.get("sucesso", []):
            linha_id = os_item.get("linha_id")
            if linha_id:
                try:
                    atualizar_status_por_linha(os_item.get("aba") or NOME_ABA, int(linha_id))
                except Exception:
                    logger.exception("Erro ao atualizar linha %s", linha_id)

        # Toast de erro exibido pela tela ao tentar salvar a OS: gravar a
        # mensagem na coluna OBS da planilha (acrescentando ao que já
        # estiver escrito na célula). O status na planilha não é alterado,
        # então a OS permanece pendente (não vira "OS Lançada"). O erro em si
        # já é registrado na tabela de logs por executar_abertura_os para
        # toda falha.
        for os_item in resultado.get("falha", []):
            if not os_item.get("toast_erro"):
                continue
            linha_id = os_item.get("linha_id")
            motivo = os_item.get("motivo") or ""
            if linha_id:
                try:
                    atualizar_obs_por_linha(os_item.get("aba") or NOME_ABA, int(linha_id), motivo)
                except Exception:
                    logger.exception("Erro ao atualizar OBS da linha %s", linha_id)

        _exec_store[execucao_id]["resultado"] = resultado
        _exec_store[execucao_id]["status"] = "done"
        logger.info("Execucao finalizada")
    except Exception as exc:
        logger.exception("Erro durante execucao em background")
        _exec_store[execucao_id]["status"] = "error"
        _exec_store[execucao_id]["resultado"] = {
            "status": "error", "sucesso": [], "falha": [{"motivo": str(exc)}],
        }
        registrar_log_automacao(
            "erro",
            "Erro interno durante execucao da automacao em segundo plano.",
            execucao_id,
            usuario_id,
            detalhe=str(exc),
        )
    finally:
        sys.stdout = original_stdout


# ==============================
# API
# ==============================
@app.get("/abas")
def listar_abas(current_user: dict = Depends(require_auth)):
    cached_abas = obter_abas_cache(max_age_seconds=ABAS_CACHE_TTL_SECONDS)
    if cached_abas:
        return {"abas": cached_abas, "origem": "cache"}

    if abas_em_backoff():
        return {
            "abas": listar_abas_fallback(),
            "origem": "fallback_backoff",
            "warning": "Google Sheets temporariamente em espera por limite de leitura.",
        }

    try:
        sheet = get_sheets_service()
        meta = sheet.get(
            spreadsheetId=SPREADSHEET_ID,
            fields="sheets(properties(title))",
        ).execute()
        abas = [reparar_texto_mojibake(sheet_item["properties"]["title"]) for sheet_item in meta["sheets"]]
        salvar_abas_cache(abas)
        return {"abas": abas, "origem": "google"}
    except Exception as exc:
        logger.exception("Erro ao listar abas")
        registrar_backoff_abas()
        fallback = listar_abas_fallback()
        logger.warning("Usando fallback de abas por indisponibilidade/quota do Google Sheets.")
        return {
            "abas": fallback,
            "origem": "fallback",
            "warning": "Nao foi possivel atualizar a lista de abas agora."
        }


@app.get("/os")
def listar_os(aba: str | None = None, force: bool = False, current_user: dict = Depends(require_auth)):
    aba_ativa = aba or NOME_ABA
    cached_dados = None if force else obter_os_cache(aba_ativa, max_age_seconds=OS_CACHE_TTL_SECONDS)
    if cached_dados is not None:
        return {
            "status": "ok",
            "aba": aba_ativa,
            "quantidade": len(cached_dados),
            "dados": cached_dados,
            "origem": "cache",
        }

    if os_em_backoff(aba_ativa):
        stale_dados = obter_os_cache(aba_ativa)
        if stale_dados is not None:
            return {
                "status": "ok",
                "aba": aba_ativa,
                "quantidade": len(stale_dados),
                "dados": stale_dados,
                "origem": "cache_stale_backoff",
                "warning": "Dados temporariamente servidos do cache.",
            }

        return {
            "status": "warning",
            "aba": aba_ativa,
            "quantidade": 0,
            "dados": [],
            "origem": "empty_fallback_backoff",
            "warning": "Nao foi possivel consultar a planilha agora. Tente novamente em instantes.",
        }

    try:
        logger.info("Lendo OS da aba: %s", aba_ativa)
        dados = ler_planilha_api(aba_ativa)
        salvar_os_cache(aba_ativa, dados)
        return {
            "status": "ok",
            "aba": aba_ativa,
            "quantidade": len(dados),
            "dados": dados,
            "origem": "google",
        }
    except Exception as exc:
        logger.exception("Erro ao buscar OS")
        registrar_backoff_os(aba_ativa)
        stale_dados = obter_os_cache(aba_ativa)
        if stale_dados is not None:
            logger.warning("Usando cache stale da aba %s por indisponibilidade/quota do Google Sheets.", aba_ativa)
            return {
                "status": "ok",
                "aba": aba_ativa,
                "quantidade": len(stale_dados),
                "dados": stale_dados,
                "origem": "cache_stale",
                "warning": "Dados temporariamente servidos do cache.",
            }

        return {
            "status": "warning",
            "aba": aba_ativa,
            "quantidade": 0,
            "dados": [],
            "origem": "empty_fallback",
            "warning": "Nao foi possivel consultar a planilha agora. Tente novamente em instantes.",
        }


@app.get("/saldo/{empresa}")
def consultar_saldo_empresa(empresa: str, current_user: dict = Depends(require_auth)):
    dados = ler_clientes()
    cliente = next(
        (
            c for c in dados["clientes"]
            if c["empresa"].upper() == empresa.upper() and c.get("ativo", True)
        ),
        None,
    )

    if not cliente:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")

    url = cliente.get("experience_url_pedidos")
    if not url:
        raise HTTPException(status_code=400, detail="Empresa nao possui link de pedidos configurado")

    try:
        logger.info("Consultando saldo para %s", empresa)
        resultado = extrair_saldo_fap(url)
        resultado["ultima_atualizacao"] = datetime.now().isoformat()

        cache = ler_cache()
        cache[empresa] = resultado
        salvar_cache(cache)

        return {"status": "ok", "empresa": empresa, "dados": resultado}
    except Exception as exc:
        logger.exception("Erro ao consultar saldo")
        raise HTTPException(status_code=500, detail="Erro interno ao consultar saldo") from exc


@app.post("/saldo-multiplo")
def consultar_saldo_multiplo(empresas: list = Body(...), current_user: dict = Depends(require_auth)):
    if not empresas:
        raise HTTPException(status_code=400, detail="Lista vazia")

    dados_clientes = ler_clientes()
    lista_processar = []

    for nome_empresa in empresas:
        cliente = next(
            (
                c for c in dados_clientes["clientes"]
                if c["empresa"].upper() == nome_empresa.upper() and c.get("ativo", True)
            ),
            None,
        )
        if not cliente:
            continue

        lista_processar.append({
            "empresa": cliente["empresa"],
            "url": cliente.get("experience_url_pedidos"),
        })

    if not lista_processar:
        raise HTTPException(status_code=404, detail="Nenhuma empresa valida encontrada")

    logger.info("Iniciando processamento multiplo de saldo")
    resultados = extrair_saldo_fap_multiplo(lista_processar)

    cache = ler_cache()
    for empresa, resultado in resultados.items():
        cache[empresa] = resultado
    salvar_cache(cache)

    return {
        "status": "finalizado",
        "consultadas": len(resultados),
        "dados": resultados,
    }


@app.get("/cache")
def retornar_cache_completo(current_user: dict = Depends(require_auth)):
    clientes_data = ler_clientes()
    cache = ler_cache()

    for cliente in clientes_data.get("clientes", []):
        if not cliente.get("ativo", True):
            continue

        empresa = cliente.get("empresa", "").strip()
        if empresa not in cache:
            cache[empresa] = {
                "codigo": None,
                "hrs_alocadas": None,
                "hrs_consumidas": None,
                "saldo_horas": None,
                "tipo_operacao": None,
                "tipo": None,
                "data_mais_recente": None,
                "ultima_atualizacao": None,
            }

    return cache


@app.post("/executar")
def executar_automacao(
    background_tasks: BackgroundTasks,
    payload: dict | list = Body(...),
    current_user: dict = Depends(require_auth),
):
    if isinstance(payload, list):
        itens = payload
        execucao_id = str(uuid4())
        usuario_id = current_user.get("id")
    else:
        itens = payload.get("itens") or payload.get("payload") or []
        execucao_id = payload.get("execucao_id") or str(uuid4())
        usuario_id = payload.get("usuario_id") or current_user.get("id")

    if not itens:
        raise HTTPException(status_code=400, detail="Nenhuma OS enviada")

    registrar_log_automacao(
        "info",
        f"Execucao recebida; processamento iniciado em segundo plano com {len(itens)} item(ns).",
        execucao_id,
        usuario_id,
    )
    background_tasks.add_task(
        executar_automacao_em_background,
        itens,
        execucao_id,
        usuario_id,
        current_user["email"],
    )

    return {
        "status": "Automacao iniciada",
        "execucao_id": execucao_id,
        "em_andamento": True,
        "sucesso": [],
        "falha": [],
    }


@app.get("/executar/status/{execucao_id}")
def status_execucao(
    execucao_id: str,
    after: int = 0,
    current_user: dict = Depends(require_auth),
):
    store = _exec_store.get(execucao_id)
    if not store:
        return {"status": "not_found", "logs": [], "total": 0, "resultado": None}
    logs = store["logs"]
    return {
        "status": store["status"],
        "logs": logs[after:],
        "total": len(logs),
        "resultado": store.get("resultado"),
    }


def _executar_apontamento_em_background(
    itens: list,
    execucao_id: str,
    usuario_id: str | None,
    usuario_email: str,
) -> None:
    try:
        logger.info("Apontamento automático iniciado por %s", usuario_email)
        resultado = executar_fluxo_apontamento(itens)

        # Atualizar status_os para "OS Apontada" nos sucessos
        db = get_db()
        for apt in resultado.get("sucesso", []):
            apontamento_id = apt.get("apontamento_id")
            if apontamento_id:
                try:
                    db.table("solicitacoes_os").update({
                        "status_os": "OS Apontada",
                        "atualizado_em": datetime.now().isoformat(),
                    }).eq("id", apontamento_id).execute()
                except Exception:
                    logger.exception("Erro ao atualizar status_os do apontamento %s", apontamento_id)

        registrar_log_automacao(
            "sucesso" if not resultado.get("falha") else "aviso",
            f"Apontamento finalizado. Sucesso: {len(resultado.get('sucesso', []))} | Falha: {len(resultado.get('falha', []))}",
            execucao_id,
            usuario_id,
        )
        logger.info("Apontamento automático finalizado")
    except Exception as exc:
        logger.exception("Erro no apontamento automático em background")
        registrar_log_automacao(
            "erro",
            "Erro interno durante apontamento automático em segundo plano.",
            execucao_id,
            usuario_id,
            detalhe=str(exc),
        )


@app.post("/executar-apontamento")
def executar_apontamento(
    background_tasks: BackgroundTasks,
    payload: dict | list = Body(...),
    current_user: dict = Depends(require_auth),
):
    if isinstance(payload, list):
        itens = payload
        execucao_id = str(uuid4())
        usuario_id = current_user.get("id")
    else:
        itens = payload.get("itens") or []
        execucao_id = payload.get("execucao_id") or str(uuid4())
        usuario_id = payload.get("usuario_id") or current_user.get("id")

    if not itens:
        raise HTTPException(status_code=400, detail="Nenhum apontamento enviado")

    registrar_log_automacao(
        "info",
        f"Apontamento automático recebido com {len(itens)} item(ns) — iniciando em background.",
        execucao_id,
        usuario_id,
    )
    background_tasks.add_task(
        _executar_apontamento_em_background,
        itens,
        execucao_id,
        usuario_id,
        current_user["email"],
    )

    return {
        "status": "Apontamento iniciado",
        "execucao_id": execucao_id,
        "em_andamento": True,
        "sucesso": [],
        "falha": [],
    }
