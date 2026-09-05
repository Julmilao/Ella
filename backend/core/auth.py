from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from fastapi import Depends, Header, HTTPException

from core.db import get_db
from core.env import get_required_env, load_local_env

load_local_env()
logger = logging.getLogger(__name__)


def _load_profile(user_id: str) -> tuple[str, list[str], str | None]:
    try:
        db = get_db()
        profile_res = (
            db.table("profiles")
            .select("nome, role")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        access_res = (
            db.table("user_module_access")
            .select("module_key, has_access")
            .eq("user_id", user_id)
            .eq("has_access", True)
            .execute()
        )

        profile = profile_res.data or {}
        module_access = sorted(
            {
                row.get("module_key")
                for row in (access_res.data or [])
                if row.get("module_key")
            }
        )
        return str(profile.get("role") or "user"), module_access, profile.get("nome")
    except Exception:
        logger.exception("Nao foi possivel carregar perfil/permissoes do usuario %s.", user_id)
        return "user", [], None


def get_session_user(token: str) -> dict[str, Any] | None:
    """Valida o JWT do Supabase e retorna o perfil do usuario autenticado."""
    supabase_url = get_required_env("SUPABASE_URL")
    supabase_anon_key = get_required_env("SUPABASE_ANON_KEY")

    try:
        req = urllib.request.Request(
            f"{supabase_url}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": supabase_anon_key,
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        user_id = data.get("id")
        role, module_access, profile_name = _load_profile(user_id) if user_id else ("user", [], None)

        return {
            "id": user_id,
            "email": data.get("email"),
            "name": profile_name or data.get("user_metadata", {}).get("name") or data.get("email"),
            "role": role,
            "module_access": module_access,
        }
    except urllib.error.HTTPError:
        return None
    except urllib.error.URLError as exc:
        logger.exception("Falha de rede ao validar sessao no Supabase.")
        raise RuntimeError("Nao foi possivel validar a sessao no Supabase.") from exc
    except Exception as exc:
        logger.exception("Falha inesperada ao validar sessao no Supabase.")
        raise RuntimeError("Erro interno ao validar a sessao.") from exc


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Token de acesso ausente.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Token de acesso invalido.")

    return token.strip()


def require_auth(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = extract_bearer_token(authorization)
    try:
        user = get_session_user(token)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not user:
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")
    return user


def require_module_access(module_key: str):
    def dependency(current_user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
        if current_user.get("role") == "admin":
            return current_user

        granted_modules = set(current_user.get("module_access") or [])
        if module_key not in granted_modules:
            raise HTTPException(
                status_code=403,
                detail="Usuario sem permissao para acessar este recurso.",
            )

        return current_user

    return dependency


def create_session(user: dict[str, Any]) -> str:
    raise NotImplementedError("Auth gerenciado pelo Supabase.")


def register_user(name: str, email: str, password: str) -> dict[str, Any]:
    raise NotImplementedError("Registro gerenciado pelo Supabase.")


def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    raise NotImplementedError("Login gerenciado pelo Supabase.")


def revoke_session(token: str) -> None:
    pass
