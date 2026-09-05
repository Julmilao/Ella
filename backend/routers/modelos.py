from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.auth import require_module_access
from core.db import get_db

router = APIRouter(
    prefix="/modelos",
    tags=["modelos"],
    dependencies=[Depends(require_module_access("modelos"))],
)


# ── Schemas ────────────────────────────────────────────────────────────────────

class ModeloCreate(BaseModel):
    assunto: str
    corpo: str
    ativo: bool = True


class ModeloUpdate(BaseModel):
    assunto: Optional[str] = None
    corpo: Optional[str] = None
    ativo: Optional[bool] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
def listar_modelos(apenas_ativos: bool = False):
    db = get_db()
    q = db.table("modelos_email").select("*").order("assunto")
    if apenas_ativos:
        q = q.eq("ativo", True)
    res = q.execute()
    return {"status": "ok", "data": res.data}


@router.get("/{modelo_id}")
def obter_modelo(modelo_id: int):
    db = get_db()
    res = db.table("modelos_email").select("*").eq("id", modelo_id).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return {"status": "ok", "data": res.data}


@router.post("", status_code=201)
def criar_modelo(payload: ModeloCreate):
    db = get_db()
    res = db.table("modelos_email").insert(payload.model_dump()).execute()
    return {"status": "ok", "data": res.data[0]}


@router.put("/{modelo_id}")
def atualizar_modelo(modelo_id: int, payload: ModeloUpdate):
    db = get_db()
    existe = db.table("modelos_email").select("id").eq("id", modelo_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    res = db.table("modelos_email").update(campos).eq("id", modelo_id).execute()
    return {"status": "ok", "data": res.data[0]}


@router.delete("/{modelo_id}")
def excluir_modelo(modelo_id: int):
    """Soft delete — marca ativo = false."""
    db = get_db()
    existe = db.table("modelos_email").select("id").eq("id", modelo_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    db.table("modelos_email").update({"ativo": False}).eq("id", modelo_id).execute()
    return {"status": "ok", "message": "Modelo desativado."}
