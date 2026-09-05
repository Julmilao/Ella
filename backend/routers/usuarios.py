from __future__ import annotations

import logging
import secrets
import string
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from core.auth import require_module_access
from core.db import get_db
from scheduler.email_sender import send_email

router = APIRouter(
    prefix="/usuarios",
    tags=["usuarios"],
    dependencies=[Depends(require_module_access("usuarios"))],
)
logger = logging.getLogger(__name__)


class UsuarioCriar(BaseModel):
    nome: str
    email: EmailStr
    senha: Optional[str] = None  # obrigatória para admin; gerada automaticamente para user
    role: Literal["admin", "user"] = "user"


class UsuarioUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[Literal["admin", "user"]] = None


class AcessoModulo(BaseModel):
    module_key: str
    has_access: bool


class ResetSenha(BaseModel):
    nova_senha: str


def _texto_erro(exc: Exception) -> str:
    return str(exc).strip() or exc.__class__.__name__


def _falha_supabase(exc: Exception) -> bool:
    if isinstance(exc, (httpx.HTTPError, httpx.TimeoutException)):
        return True

    texto = _texto_erro(exc).lower()
    return any(
        trecho in texto
        for trecho in (
            "connecterror",
            "connection refused",
            "timed out",
            "timeout",
            "temporarily unavailable",
            "name or service not known",
            "nodename nor servname",
            "winerror 10013",
            "winerror 10061",
            "network is unreachable",
            "forbidden by its access permissions",
        )
    )


_ESPECIAIS = "!@#$%&*"

def _gerar_senha(tamanho: int = 12) -> str:
    """Gera senha com mín. 8 chars, 1 maiúsculo, 1 minúsculo, 1 dígito, 1 especial."""
    tamanho = max(tamanho, 8)
    alfabeto = string.ascii_letters + string.digits + _ESPECIAIS
    while True:
        senha = "".join(secrets.choice(alfabeto) for _ in range(tamanho))
        if (
            any(c.isupper() for c in senha)
            and any(c.islower() for c in senha)
            and any(c.isdigit() for c in senha)
            and any(c in _ESPECIAIS for c in senha)
        ):
            return senha


def _carregar_smtp(db) -> dict:
    try:
        res = db.table("configuracoes_gerais").select("*").limit(1).execute()
        return res.data[0] if res.data else {}
    except Exception:
        return {}


def _enviar_senha_por_email(db, email: str, nome: str, senha: str, acao: str = "criação") -> None:
    smtp = _carregar_smtp(db)
    if not smtp.get("smtp_host"):
        logger.warning("usuarios: SMTP nao configurado — email de senha nao enviado para %s", email)
        return
    _rodape = """
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#aaa;font-size:11px;text-align:center">
        Este é um email automático — <strong>não responda a esta mensagem</strong>.<br>
        ELLA SO · Sistema Operacional Interno
      </p>
    """
    assunto = "Sua senha de acesso — ELLA SO"
    corpo = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#1a7a4a">Olá, {nome}!</h2>
      <p>Sua conta no <strong>ELLA SO</strong> foi {'criada' if acao == 'criação' else 'atualizada'}.</p>
      <p>Suas credenciais de acesso:</p>
      <div style="background:#f4f4f4;border-radius:8px;padding:16px 20px;margin:16px 0">
        <p style="margin:4px 0"><strong>Email:</strong> {email}</p>
        <p style="margin:4px 0"><strong>Senha:</strong>
          <span style="font-family:monospace;font-size:16px;letter-spacing:2px">{senha}</span>
        </p>
      </div>
      <p style="color:#888;font-size:13px">Por segurança, recomendamos anotar sua senha em local seguro.</p>
      {_rodape}
    </div>
    """
    try:
        send_email(smtp, [email], assunto, corpo)
    except Exception as exc:
        logger.warning("usuarios: falha ao enviar email de senha para %s: %s", email, exc)


def _raise_db_error(acao: str, exc: Exception, *, status_code: int = 500) -> None:
    logger.exception("usuarios.%s: %s", acao, _texto_erro(exc))
    if _falha_supabase(exc):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Falha de comunicacao com o Supabase ao {acao}. "
                "Verifique se o backend tem acesso a rede e se o servico esta disponivel."
            ),
        )
    raise HTTPException(status_code=status_code, detail=f"Erro ao {acao}: {_texto_erro(exc)}")


@router.get("")
def listar_usuarios():
    db = get_db()
    try:
        res = (
            db.table("profiles")
            .select("*, user_module_access(module_key, has_access)")
            .order("nome")
            .execute()
        )
    except Exception as exc:
        _raise_db_error("listar usuarios", exc)
    return {"status": "ok", "data": res.data}


@router.post("")
def criar_usuario(payload: UsuarioCriar):
    db = get_db()

    # Admin deve informar senha explicitamente; usuário comum recebe senha gerada
    if payload.role == "admin" and not payload.senha:
        raise HTTPException(status_code=400, detail="Senha obrigatoria para usuarios do tipo admin.")

    senha_final = payload.senha if payload.senha else _gerar_senha()
    senha_gerada = not payload.senha  # flag para enviar email

    try:
        existente = (
            db.table("profiles")
            .select("id")
            .eq("email", payload.email)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_db_error("consultar usuarios existentes", exc)

    if existente.data:
        raise HTTPException(status_code=409, detail="Ja existe um usuario com este e-mail.")

    try:
        auth_resp = db.auth.admin.create_user(
            {
                "email": payload.email,
                "password": senha_final,
                "email_confirm": True,
                "user_metadata": {"name": payload.nome},
            }
        )
    except Exception as exc:
        if _falha_supabase(exc):
            _raise_db_error("criar usuario no Auth", exc, status_code=503)
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao criar usuario no Auth: {_texto_erro(exc)}",
        )

    user_id = auth_resp.user.id

    try:
        db.table("profiles").upsert(
            {
                "user_id": user_id,
                "email": payload.email,
                "nome": payload.nome,
                "role": payload.role,
                "senha_temporaria": senha_gerada,  # True se gerada pelo sistema
            },
            on_conflict="user_id",
        ).execute()
    except Exception as exc:
        try:
            db.auth.admin.delete_user(user_id)
        except Exception as cleanup_exc:
            logger.warning(
                "usuarios.criar_usuario: falha ao reverter usuario %s no Auth: %s",
                user_id,
                _texto_erro(cleanup_exc),
            )
        _raise_db_error("criar perfil do usuario", exc)

    if senha_gerada:
        _enviar_senha_por_email(db, payload.email, payload.nome, senha_final, "criação")

    return {
        "status": "ok",
        "data": {
            "user_id": user_id,
            "email": payload.email,
            "nome": payload.nome,
            "senha_enviada_por_email": senha_gerada,
        },
    }


@router.get("/{user_id}")
def obter_usuario(user_id: str):
    db = get_db()
    try:
        res = (
            db.table("profiles")
            .select("*, user_module_access(module_key, has_access)")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        _raise_db_error("obter usuario", exc)

    if not res.data:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    return {"status": "ok", "data": res.data}


@router.put("/{user_id}")
def atualizar_usuario(user_id: str, payload: UsuarioUpdate):
    db = get_db()
    try:
        existe = db.table("profiles").select("id").eq("user_id", user_id).maybe_single().execute()
    except Exception as exc:
        _raise_db_error("validar usuario para atualizacao", exc)

    if not existe.data:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")

    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    if payload.email:
        try:
            db.auth.admin.update_user_by_id(user_id, {"email": payload.email})
        except Exception as exc:
            if _falha_supabase(exc):
                _raise_db_error("atualizar e-mail do usuario", exc, status_code=503)
            raise HTTPException(
                status_code=400,
                detail=f"Erro ao atualizar e-mail: {_texto_erro(exc)}",
            )

    campos_profile = {k: v for k, v in campos.items() if k in ("nome", "role", "email")}
    if campos_profile:
        try:
            db.table("profiles").update(campos_profile).eq("user_id", user_id).execute()
        except Exception as exc:
            _raise_db_error("atualizar perfil do usuario", exc)

    return {"status": "ok"}


@router.delete("/{user_id}")
def excluir_usuario(user_id: str):
    db = get_db()
    try:
        existe = (
            db.table("profiles")
            .select("id, email")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        _raise_db_error("validar usuario para exclusao", exc)

    if not existe.data:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")

    try:
        db.table("profiles").delete().eq("user_id", user_id).execute()
    except Exception as exc:
        _raise_db_error("remover perfil do usuario", exc)

    try:
        db.auth.admin.delete_user(user_id)
    except Exception as exc:
        _raise_db_error("remover usuario do Auth", exc)

    return {"status": "ok", "message": "Usuario excluido."}


@router.put("/{user_id}/reset-senha")
def reset_senha_usuario(user_id: str, payload: ResetSenha):
    if len(payload.nova_senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 6 caracteres.")

    db = get_db()
    try:
        existe = db.table("profiles").select("id").eq("user_id", user_id).maybe_single().execute()
    except Exception as exc:
        _raise_db_error("validar usuario para reset de senha", exc)

    if not existe.data:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")

    try:
        db.auth.admin.update_user_by_id(user_id, {"password": payload.nova_senha})
    except Exception as exc:
        if _falha_supabase(exc):
            _raise_db_error("redefinir senha do usuario", exc, status_code=503)
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao redefinir senha: {_texto_erro(exc)}",
        )

    return {"status": "ok", "message": "Senha redefinida com sucesso."}


@router.put("/{user_id}/acesso")
def definir_acesso_modulo(user_id: str, payload: AcessoModulo):
    db = get_db()
    try:
        existe = db.table("profiles").select("id").eq("user_id", user_id).maybe_single().execute()
    except Exception as exc:
        _raise_db_error("validar usuario para atualizar acesso", exc)

    if not existe.data:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")

    try:
        res = db.table("user_module_access").upsert(
            {
                "user_id": user_id,
                "module_key": payload.module_key,
                "has_access": payload.has_access,
            },
            on_conflict="user_id,module_key",
        ).execute()
    except Exception as exc:
        _raise_db_error("atualizar acesso do usuario", exc)

    return {"status": "ok", "data": res.data[0] if res.data else {}}
