from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, EmailStr
from core.auth import require_module_access
from core.db import get_db

router = APIRouter(
    prefix="/status-report",
    tags=["status-report"],
    dependencies=[Depends(require_module_access("status_report"))],
)


# ── Schemas ────────────────────────────────────────────────────────────────────

class ConfigCreate(BaseModel):
    cliente_id: str
    modelo_id: Optional[int] = None
    fap: Optional[str] = None
    periodo: Optional[str] = None
    dia_envio: int
    enviar_sem_os: bool = False
    ativo: bool = True

    @field_validator("dia_envio")
    @classmethod
    def dia_valido(cls, v: int) -> int:
        if not (1 <= v <= 28):
            raise ValueError("dia_envio deve ser entre 1 e 28")
        return v


class ConfigUpdate(BaseModel):
    modelo_id: Optional[int] = None
    fap: Optional[str] = None
    periodo: Optional[str] = None
    dia_envio: Optional[int] = None
    enviar_sem_os: Optional[bool] = None
    ativo: Optional[bool] = None

    @field_validator("dia_envio")
    @classmethod
    def dia_valido(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 28):
            raise ValueError("dia_envio deve ser entre 1 e 28")
        return v


class DestinatarioCreate(BaseModel):
    email: EmailStr
    ativo: bool = True


# ── Configs ────────────────────────────────────────────────────────────────────

@router.get("")
def listar_configs():
    db = get_db()
    res = db.table("status_report_configs").select(
        "*, clientes(nome), modelos_email(assunto), sr_destinatarios(id, email, ativo)"
    ).order("criado_em", desc=True).execute()
    return {"status": "ok", "data": res.data}


@router.get("/{config_id}")
def obter_config(config_id: str):
    db = get_db()
    res = db.table("status_report_configs").select(
        "*, clientes(nome), modelos_email(assunto), sr_destinatarios(id, email, ativo)"
    ).eq("id", config_id).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    return {"status": "ok", "data": res.data}


@router.post("", status_code=201)
def criar_config(payload: ConfigCreate):
    db = get_db()

    # Valida cliente
    cliente = db.table("clientes").select("id").eq("id", payload.cliente_id).maybeSingle().execute()
    if not cliente.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    # Valida modelo se informado
    if payload.modelo_id:
        modelo = db.table("modelos_email").select("id").eq("id", payload.modelo_id).maybeSingle().execute()
        if not modelo.data:
            raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.")

    res = db.table("status_report_configs").insert(payload.model_dump()).execute()
    return {"status": "ok", "data": res.data[0]}


@router.put("/{config_id}")
def atualizar_config(config_id: str, payload: ConfigUpdate):
    db = get_db()
    existe = db.table("status_report_configs").select("id").eq("id", config_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")

    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    res = db.table("status_report_configs").update(campos).eq("id", config_id).execute()
    return {"status": "ok", "data": res.data[0]}


@router.delete("/{config_id}")
def excluir_config(config_id: str):
    db = get_db()
    existe = db.table("status_report_configs").select("id").eq("id", config_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")

    db.table("status_report_configs").delete().eq("id", config_id).execute()
    return {"status": "ok", "message": "Configuração excluída."}


# ── Destinatários ──────────────────────────────────────────────────────────────

@router.get("/{config_id}/destinatarios")
def listar_destinatarios(config_id: str):
    db = get_db()
    res = db.table("sr_destinatarios").select("*").eq("config_id", config_id).order("email").execute()
    return {"status": "ok", "data": res.data}


@router.post("/{config_id}/destinatarios", status_code=201)
def adicionar_destinatario(config_id: str, payload: DestinatarioCreate):
    db = get_db()

    # Verifica se config existe
    existe = db.table("status_report_configs").select("id").eq("id", config_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")

    # Evita duplicata
    dup = db.table("sr_destinatarios").select("id").eq("config_id", config_id).eq("email", payload.email).maybeSingle().execute()
    if dup.data:
        raise HTTPException(status_code=409, detail=f"E-mail {payload.email} já cadastrado nesta configuração.")

    res = db.table("sr_destinatarios").insert({
        "config_id": config_id,
        "email": payload.email,
        "ativo": payload.ativo,
    }).execute()
    return {"status": "ok", "data": res.data[0]}


@router.patch("/{config_id}/destinatarios/{dest_id}")
def toggle_destinatario(config_id: str, dest_id: str, body: dict):
    db = get_db()
    existe = db.table("sr_destinatarios").select("id").eq("id", dest_id).eq("config_id", config_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Destinatário não encontrado.")

    db.table("sr_destinatarios").update({"ativo": body.get("ativo", True)}).eq("id", dest_id).execute()
    return {"status": "ok"}


@router.delete("/{config_id}/destinatarios/{dest_id}")
def remover_destinatario(config_id: str, dest_id: str):
    db = get_db()
    existe = db.table("sr_destinatarios").select("id").eq("id", dest_id).eq("config_id", config_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Destinatário não encontrado.")

    db.table("sr_destinatarios").delete().eq("id", dest_id).execute()
    return {"status": "ok", "message": "Destinatário removido."}
