from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from core.auth import require_module_access
from core.db import get_db
from scheduler import email_sender

DEBUG_DIR = Path(__file__).resolve().parents[1] / "runtime" / "debug_rpa"

router = APIRouter(tags=["configuracoes"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class ConfigGeralUpdate(BaseModel):
    exp_usuario: Optional[str] = None
    exp_senha: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_porta: Optional[int] = None
    smtp_usuario: Optional[str] = None
    smtp_senha: Optional[str] = None
    smtp_de_nome: Optional[str] = None
    smtp_usar_tls: Optional[bool] = None
    pdf_nome_empresa: Optional[str] = None
    pdf_cabecalho: Optional[str] = None
    pdf_rodape: Optional[str] = None
    pdf_logo_url: Optional[str] = None
    pdf_incluir_horas: Optional[bool] = None
    rpa_debug_video: Optional[bool] = None
    rpa_debug_trace: Optional[bool] = None


class SmtpTestarPayload(BaseModel):
    destinatario: str


_TESTE_SMTP_BODY = """\
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#1a6b37;padding:28px 32px;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">ELLA OS</h1>
      <p style="color:#a8d5b5;margin:4px 0 0;font-size:13px;">Sankhya Experience</p>
    </div>
    <div style="padding:32px;">
      <p style="font-size:15px;color:#222;margin-top:0;">Olá,</p>
      <p style="font-size:14px;color:#444;line-height:1.6;">
        Este é um e-mail de teste automático enviado pela plataforma <strong>ELLA OS</strong>.<br>
        Se você recebeu esta mensagem, a configuração SMTP está correta. ✅
      </p>
    </div>
    <div style="background:#f0f0f0;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#888;margin:0;">ELLA OS · Sankhya Experience</p>
    </div>
  </div>
</body>
</html>
"""


# ── Configurações Gerais ───────────────────────────────────────────────────────

@router.get("/configuracoes", dependencies=[Depends(require_module_access("admin"))])
def obter_configuracoes():
    db = get_db()
    res = db.table("configuracoes_gerais").select("*").limit(1).execute()
    return {"status": "ok", "data": res.data[0] if res.data else {}}


@router.put("/configuracoes", dependencies=[Depends(require_module_access("admin"))])
def salvar_configuracoes(payload: ConfigGeralUpdate):
    db = get_db()
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    # Verifica se já existe um registro
    existente = db.table("configuracoes_gerais").select("id").limit(1).execute()

    if existente.data:
        config_id = existente.data[0]["id"]
        res = db.table("configuracoes_gerais").update(campos).eq("id", config_id).execute()
    else:
        res = db.table("configuracoes_gerais").insert(campos).execute()

    return {"status": "ok", "data": res.data[0] if res.data else {}}


# ── SMTP — Teste de envio ──────────────────────────────────────────────────────

@router.post("/smtp/testar", dependencies=[Depends(require_module_access("admin"))])
def testar_smtp(payload: SmtpTestarPayload):
    """Send a test e-mail to the given recipient using the saved SMTP config."""
    if not payload.destinatario:
        raise HTTPException(status_code=400, detail="Informe um destinatário.")

    db = get_db()
    res = db.table("configuracoes_gerais").select("*").limit(1).execute()
    smtp_config: dict = res.data[0] if res.data else {}

    if not smtp_config.get("smtp_host"):
        raise HTTPException(status_code=422, detail="Configuração SMTP não encontrada. Salve as configurações primeiro.")

    resultado = email_sender.send_email(
        smtp_config=smtp_config,
        to_emails=[payload.destinatario],
        subject="✅ Teste SMTP — ELLA OS",
        body=_TESTE_SMTP_BODY,
        pdf_path=None,
    )

    if payload.destinatario in resultado["sucesso"]:
        return {"status": "ok", "message": f"E-mail de teste enviado para {payload.destinatario}."}

    erro = resultado["erro"].get(payload.destinatario, "Erro desconhecido.")
    raise HTTPException(status_code=502, detail=f"Falha ao enviar e-mail: {erro}")


# ── Envios ─────────────────────────────────────────────────────────────────────

@router.get("/envios", dependencies=[Depends(require_module_access("status_report"))])
def listar_envios(
    config_id: Optional[str] = None,
    status: Optional[str] = None,
    pagina: int = Query(default=1, ge=1),
    por_pagina: int = Query(default=20, ge=1, le=100),
):
    db = get_db()
    offset = (pagina - 1) * por_pagina

    q = db.table("sr_envios").select(
        "*, status_report_configs(cliente_id, clientes(nome)), sr_envio_destinatarios(email, status_entrega)"
    ).order("enviado_em", desc=True).range(offset, offset + por_pagina - 1)

    if config_id:
        q = q.eq("config_id", config_id)
    if status:
        q = q.eq("status", status)

    res = q.execute()
    return {
        "status": "ok",
        "pagina": pagina,
        "por_pagina": por_pagina,
        "data": res.data,
    }


@router.get("/envios/{envio_id}", dependencies=[Depends(require_module_access("status_report"))])
def obter_envio(envio_id: str):
    db = get_db()
    res = db.table("sr_envios").select(
        "*, status_report_configs(cliente_id, clientes(nome)), sr_envio_destinatarios(email, status_entrega)"
    ).eq("id", envio_id).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Envio não encontrado.")
    return {"status": "ok", "data": res.data}


@router.post("/envios/{envio_id}/reprocessar", dependencies=[Depends(require_module_access("status_report"))])
def reprocessar_envio(envio_id: str):
    """
    Marca o envio como pendente para reprocessamento.
    A lógica de reenvio real será implementada no módulo de disparo.
    """
    db = get_db()
    existe = db.table("sr_envios").select("id, status").eq("id", envio_id).maybeSingle().execute()
    if not existe.data:
        raise HTTPException(status_code=404, detail="Envio não encontrado.")

    if existe.data["status"] == "pendente":
        raise HTTPException(status_code=409, detail="Envio já está com status pendente.")

    db.table("sr_envios").update({
        "status": "pendente",
        "erro_msg": None,
    }).eq("id", envio_id).execute()

    return {"status": "ok", "message": f"Envio {envio_id} marcado para reprocessamento."}


# ── Debug RPA ──────────────────────────────────────────────────────────────────

_SUFFIX_TIPO = {".webm": "video", ".zip": "trace", ".png": "screenshot"}
_SUFFIX_MEDIA = {".webm": "video/webm", ".zip": "application/zip", ".png": "image/png"}


@router.get("/automacao/debug/arquivos", dependencies=[Depends(require_module_access("admin"))])
def listar_debug_arquivos():
    """Lista execuções de debug disponíveis: vídeo (.webm), trace (.zip) e screenshots (.png)."""
    if not DEBUG_DIR.exists():
        return {"status": "ok", "data": []}

    execucoes = []
    for pasta in sorted(DEBUG_DIR.iterdir(), reverse=True):
        if not pasta.is_dir():
            continue
        arquivos = []
        for arquivo in sorted(pasta.iterdir()):
            tipo = _SUFFIX_TIPO.get(arquivo.suffix)
            if tipo:
                arquivos.append({
                    "nome": arquivo.name,
                    "tipo": tipo,
                    "tamanho_kb": round(arquivo.stat().st_size / 1024, 1),
                    "url": f"/api/automacao/debug/download/{pasta.name}/{arquivo.name}",
                })
        if arquivos:
            execucoes.append({"execucao": pasta.name, "arquivos": arquivos})

    return {"status": "ok", "data": execucoes}


@router.get("/automacao/debug/download/{execucao}/{arquivo}", dependencies=[Depends(require_module_access("admin"))])
def baixar_debug_arquivo(execucao: str, arquivo: str):
    """Baixa um arquivo de debug (vídeo .webm, trace .zip ou screenshot .png)."""
    # Sanitizar para evitar path traversal
    if ".." in execucao or ".." in arquivo:
        raise HTTPException(status_code=400, detail="Nome inválido.")

    caminho = DEBUG_DIR / execucao / arquivo
    media_type = _SUFFIX_MEDIA.get(caminho.suffix) if caminho.exists() else None
    if not media_type:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    return FileResponse(path=str(caminho), filename=arquivo, media_type=media_type)


@router.delete("/automacao/debug/arquivos", dependencies=[Depends(require_module_access("admin"))])
def limpar_debug_arquivos():
    """Remove todos os arquivos de debug gravados."""
    import shutil
    if DEBUG_DIR.exists():
        shutil.rmtree(DEBUG_DIR)
    return {"status": "ok", "message": "Arquivos de debug removidos."}
