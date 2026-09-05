from __future__ import annotations

import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from core.auth import require_module_access
from core.db import get_db

router = APIRouter(
    prefix="/clientes",
    tags=["clientes"],
    dependencies=[Depends(require_module_access("clientes"))],
)


# ── Schemas ────────────────────────────────────────────────────────────────────

def _normalizar_cnpj(v: str) -> str:
    return re.sub(r"\D", "", v or "")


_STATUS_SUSTENTACAO = {"ativo", "inativo", "suspenso"}


class ClienteCreate(BaseModel):
    nome: str
    cnpj: Optional[str] = None
    ativo: bool = True
    sustentacao_desde: Optional[str] = None
    status_sustentacao: Optional[str] = "ativo"

    @field_validator("nome")
    @classmethod
    def nome_nao_vazio(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("nome é obrigatório")
        return v.strip()

    @field_validator("cnpj")
    @classmethod
    def cnpj_valido(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        digits = _normalizar_cnpj(v)
        if len(digits) != 14:
            raise ValueError("CNPJ deve ter 14 dígitos")
        return digits

    @field_validator("status_sustentacao")
    @classmethod
    def status_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _STATUS_SUSTENTACAO:
            raise ValueError("status_sustentacao deve ser: ativo, inativo ou suspenso")
        return v


class ClienteUpdate(BaseModel):
    nome: Optional[str] = None
    cnpj: Optional[str] = None
    ativo: Optional[bool] = None
    sustentacao_desde: Optional[str] = None
    status_sustentacao: Optional[str] = None

    @field_validator("nome")
    @classmethod
    def nome_nao_vazio(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("nome não pode ser vazio")
        return v.strip() if v else v

    @field_validator("cnpj")
    @classmethod
    def cnpj_valido(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        digits = _normalizar_cnpj(v)
        if len(digits) != 14:
            raise ValueError("CNPJ deve ter 14 dígitos")
        return digits

    @field_validator("status_sustentacao")
    @classmethod
    def status_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _STATUS_SUSTENTACAO:
            raise ValueError("status_sustentacao deve ser: ativo, inativo ou suspenso")
        return v


# ── Helpers ────────────────────────────────────────────────────────────────────

def _verificar_cnpj_duplicado(db, cnpj: str, excluir_id: str | None = None):
    q = db.table("clientes").select("id").eq("cnpj", cnpj)
    if excluir_id:
        q = q.neq("id", excluir_id)
    res = q.execute()
    if res.data:
        raise HTTPException(status_code=409, detail=f"CNPJ {cnpj} já cadastrado para outro cliente.")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
def listar_clientes():
    db = get_db()
    res = db.table("clientes").select(
        "*, configuracoes_clientes(url_abertura_os, url_saldo_horas, exp_usuario, obs)"
    ).order("nome").execute()
    return {"status": "ok", "data": res.data}


@router.get("/{cliente_id}")
def obter_cliente(cliente_id: str):
    db = get_db()
    res = db.table("clientes").select(
        "*, configuracoes_clientes(url_abertura_os, url_saldo_horas, exp_usuario, obs)"
    ).eq("id", cliente_id).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    return {"status": "ok", "data": res.data}


@router.post("", status_code=201)
def criar_cliente(payload: ClienteCreate):
    db = get_db()
    if payload.cnpj:
        _verificar_cnpj_duplicado(db, payload.cnpj)

    res = db.table("clientes").insert({
        "nome": payload.nome,
        "cnpj": payload.cnpj,
        "ativo": payload.ativo,
        "sustentacao_desde": payload.sustentacao_desde,
        "status_sustentacao": payload.status_sustentacao or "ativo",
    }).execute()
    return {"status": "ok", "data": res.data[0]}


@router.put("/{cliente_id}")
def atualizar_cliente(cliente_id: str, payload: ClienteUpdate):
    db = get_db()

    # Verifica se existe
    existe = db.table("clientes").select("id").eq("id", cliente_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    if payload.cnpj:
        _verificar_cnpj_duplicado(db, payload.cnpj, excluir_id=cliente_id)

    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    res = db.table("clientes").update(campos).eq("id", cliente_id).execute()
    return {"status": "ok", "data": res.data[0]}


@router.delete("/{cliente_id}")
def excluir_cliente(cliente_id: str):
    """Soft delete — marca ativo = false."""
    db = get_db()
    existe = db.table("clientes").select("id").eq("id", cliente_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    db.table("clientes").update({"ativo": False}).eq("id", cliente_id).execute()
    return {"status": "ok", "message": "Cliente desativado."}
