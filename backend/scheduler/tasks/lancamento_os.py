from __future__ import annotations

import logging
import unicodedata
from uuid import uuid4

from core.automacao.abertura_os import executar_abertura_os
from core.db import get_db

logger = logging.getLogger(__name__)


def _normalizar_texto(valor: str | None) -> str:
    if not valor:
        return ""
    texto = unicodedata.normalize("NFD", str(valor).strip())
    texto = texto.encode("ascii", "ignore").decode("utf-8")
    return texto.lower()


def processar(modelo: dict) -> None:
    modelo_id = modelo.get("id")
    logger.info("lancamento_os.processar: iniciando modelo_id=%s", modelo_id)

    db = get_db()
    try:
        resposta = (
            db.table("solicitacoes_os")
            .select(
                "id, executante, cliente_id, data_os, hora_inicio, hora_fim, "
                "ticket, status_os, status_abertura, clientes(nome)"
            )
            .eq("status_os", "Pendente Apontamento")
            .order("data_os")
            .order("hora_inicio")
            .limit(500)
            .execute()
        )
    except Exception:
        logger.exception(
            "lancamento_os.processar: erro ao buscar solicitacoes_os para o modelo %s.",
            modelo_id,
        )
        return

    itens: list[dict] = []
    for row in resposta.data or []:
        status_abertura = _normalizar_texto(row.get("status_abertura") or "OS Nao Aberta")
        if status_abertura not in {"", "os nao aberta", "erro"}:
            continue

        cliente_rel = row.get("clientes")
        cliente = cliente_rel[0] if isinstance(cliente_rel, list) else (cliente_rel or {})
        itens.append(
            {
                "apontamento_id": row.get("id"),
                "cliente_id": row.get("cliente_id"),
                "empresa": cliente.get("nome") or "",
                "usuario": row.get("executante") or "",
                "data": row.get("data_os") or "",
                "hora_inicio": row.get("hora_inicio") or "",
                "hora_fim": row.get("hora_fim") or "",
                "ticket": row.get("ticket") or "",
            }
        )

    resultado = executar_abertura_os(
        itens,
        execucao_id=str(uuid4()),
        origem="scheduler",
        rotina_id=modelo_id,
    )

    logger.info(
        "lancamento_os.processar: modelo_id=%s finalizado com %s sucesso(s) e %s falha(s).",
        modelo_id,
        len(resultado.get("sucesso", [])),
        len(resultado.get("falha", [])),
    )
