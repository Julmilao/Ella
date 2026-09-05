from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

from core.automacao.sankhya import executar_fluxo_completo
from core.db import get_db

logger = logging.getLogger(__name__)

_EXECUCAO_LOCK = Lock()
_SENSITIVE_FIELDS = {"exp_senha", "exp_usuario"}
_RPA_OBS_PREFIX = "[RPA abertura]"


def _normalizar_texto(valor: str | None) -> str:
    if not valor:
        return ""
    texto = unicodedata.normalize("NFD", str(valor).strip())
    texto = texto.encode("ascii", "ignore").decode("utf-8")
    return texto.lower()


def _coalesce(*valores: Any) -> Any:
    for valor in valores:
        if valor is None:
            continue
        if isinstance(valor, str):
            if valor.strip():
                return valor.strip()
            continue
        return valor
    return None


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_relacionamento(valor: Any) -> dict[str, Any]:
    if isinstance(valor, list):
        return valor[0] if valor else {}
    if isinstance(valor, dict):
        return valor
    return {}


def _log_db(
    db,
    tipo: str,
    mensagem: str,
    execucao_id: str | None = None,
    usuario_id: str | None = None,
    detalhe: str | None = None,
) -> None:
    try:
        payload: dict[str, Any] = {
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
        db.table("logs").insert(payload).execute()
    except Exception:
        logger.exception("Nao foi possivel registrar log da automacao de OS.")


def _carregar_configuracao_geral(db) -> dict[str, Any]:
    try:
        resposta = (
            db.table("configuracoes_gerais")
            .select("*")
            .limit(1)
            .maybe_single()
            .execute()
        )
        return resposta.data or {}
    except Exception:
        logger.exception("Erro ao carregar configuracoes_gerais.")
        return {}


def _carregar_clientes(db) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    try:
        resposta = (
            db.table("clientes")
            .select(
                "id, nome, ativo, configuracoes_clientes(exp_usuario, exp_senha, url_abertura_os, obs)"
            )
            .eq("ativo", True)
            .execute()
        )
    except Exception:
        logger.exception("Erro ao carregar clientes/configuracoes_clientes.")
        return {}, {}

    por_id: dict[str, dict[str, Any]] = {}
    por_nome: dict[str, dict[str, Any]] = {}

    for row in resposta.data or []:
        cfg = _get_relacionamento(row.get("configuracoes_clientes"))
        cliente = {
            "id": row.get("id"),
            "nome": row.get("nome") or "",
            "url_abertura_os": cfg.get("url_abertura_os"),
            "exp_usuario": cfg.get("exp_usuario"),
            "exp_senha": cfg.get("exp_senha"),
            "obs": cfg.get("obs"),
        }
        if cliente["id"]:
            por_id[cliente["id"]] = cliente
        nome_norm = _normalizar_texto(cliente["nome"])
        if nome_norm:
            por_nome[nome_norm] = cliente

    return por_id, por_nome


def _resolver_cliente(
    item: dict[str, Any],
    clientes_por_id: dict[str, dict[str, Any]],
    clientes_por_nome: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    cliente_id = item.get("cliente_id")
    if cliente_id and cliente_id in clientes_por_id:
        return clientes_por_id[cliente_id]

    empresa = _coalesce(item.get("empresa"), item.get("cliente"))
    empresa_norm = _normalizar_texto(str(empresa or ""))
    if empresa_norm and empresa_norm in clientes_por_nome:
        return clientes_por_nome[empresa_norm]

    return {}


def _montar_item_execucao(
    item: dict[str, Any],
    cliente: dict[str, Any],
    config_geral: dict[str, Any],
) -> dict[str, Any]:
    empresa = _coalesce(item.get("empresa"), item.get("cliente"), cliente.get("nome"))
    if not empresa:
        raise ValueError("Registro sem empresa/cliente associado.")

    url_abertura = _coalesce(
        item.get("experience_url_etapas"),
        item.get("url_abertura_os"),
        cliente.get("url_abertura_os"),
    )
    if not url_abertura:
        raise ValueError(
            f'Cliente "{empresa}" sem URL de abertura configurada no Painel Admin.'
        )

    item_execucao = dict(item)
    item_execucao["empresa"] = empresa
    item_execucao["experience_url_etapas"] = url_abertura
    item_execucao["exp_usuario"] = _coalesce(
        item.get("exp_usuario"),
        config_geral.get("exp_usuario"),
        cliente.get("exp_usuario"),
    )
    item_execucao["exp_senha"] = _coalesce(
        item.get("exp_senha"),
        config_geral.get("exp_senha"),
        cliente.get("exp_senha"),
    )
    item_execucao["cliente_id"] = _coalesce(item.get("cliente_id"), cliente.get("id"))
    return item_execucao


def _limpar_item_saida(item: dict[str, Any]) -> dict[str, Any]:
    return {
        chave: valor
        for chave, valor in item.items()
        if chave not in _SENSITIVE_FIELDS
    }


def _atualizar_disparo_rotina(db, rotina_id: int | None) -> None:
    if rotina_id is None:
        return

    payload = {
        "rotina_os_id": rotina_id,
        "ultimo_disparo_os_ts": _agora_iso(),
    }

    try:
        resposta = (
            db.table("configuracoes_gerais")
            .select("id")
            .limit(1)
            .maybe_single()
            .execute()
        )
        row = resposta.data or {}
        if row.get("id") is not None:
            db.table("configuracoes_gerais").update(payload).eq("id", row["id"]).execute()
        else:
            db.table("configuracoes_gerais").insert(payload).execute()
    except Exception:
        logger.exception("Nao foi possivel atualizar ultimo_disparo_os_ts.")


def _marcar_status_apontamentos(
    db,
    itens: list[dict[str, Any]],
    status_abertura: str,
    *,
    limpar_observacao_rpa: bool = False,
) -> None:
    if not itens:
        return

    for item in itens:
        apontamento_id = item.get("apontamento_id")
        if not apontamento_id:
            continue
        try:
            observacoes = None
            if limpar_observacao_rpa:
                resposta = (
                    db.table("solicitacoes_os")
                    .select("observacoes")
                    .eq("id", apontamento_id)
                    .maybe_single()
                    .execute()
                )
                atual = (resposta.data or {}).get("observacoes")
                observacoes = _remover_observacao_rpa(atual)

            payload: dict[str, Any] = {
                "status_abertura": status_abertura,
                "atualizado_em": _agora_iso(),
            }
            if limpar_observacao_rpa:
                payload["observacoes"] = observacoes

            db.table("solicitacoes_os").update(payload).eq("id", apontamento_id).execute()
        except Exception:
            logger.exception(
                "Nao foi possivel atualizar status_abertura do apontamento %s.",
                apontamento_id,
            )


def _remover_observacao_rpa(texto: str | None) -> str | None:
    if not texto:
        return None

    linhas = [linha.strip() for linha in str(texto).splitlines()]
    linhas_filtradas = [linha for linha in linhas if linha and not linha.startswith(_RPA_OBS_PREFIX)]
    if not linhas_filtradas:
        return None
    return "\n".join(linhas_filtradas)


def _mesclar_observacao_rpa(texto_atual: str | None, motivo: str) -> str:
    base = _remover_observacao_rpa(texto_atual)
    nova_linha = f"{_RPA_OBS_PREFIX} {motivo}"
    if base:
        return f"{base}\n{nova_linha}"
    return nova_linha


def _registrar_falhas_apontamentos(
    db,
    itens: list[dict[str, Any]],
) -> None:
    if not itens:
        return

    for item in itens:
        apontamento_id = item.get("apontamento_id")
        if not apontamento_id:
            continue
        try:
            resposta = (
                db.table("solicitacoes_os")
                .select("observacoes")
                .eq("id", apontamento_id)
                .maybe_single()
                .execute()
            )
            observacoes_atuais = (resposta.data or {}).get("observacoes")
            motivo = str(item.get("motivo") or "Falha sem detalhe informado.")
            observacoes = _mesclar_observacao_rpa(observacoes_atuais, motivo)

            db.table("solicitacoes_os").update(
                {
                    "status_abertura": "OS Não Aberta",
                    "observacoes": observacoes,
                    "atualizado_em": _agora_iso(),
                }
            ).eq("id", apontamento_id).execute()
        except Exception:
            logger.exception(
                "Nao foi possivel registrar falha de abertura no apontamento %s.",
                apontamento_id,
            )


def executar_abertura_os(
    itens: list[dict[str, Any]],
    *,
    execucao_id: str | None = None,
    usuario_id: str | None = None,
    origem: str = "manual",
    rotina_id: int | None = None,
) -> dict[str, Any]:
    db = get_db()
    execucao_id = execucao_id or str(uuid4())

    acquired = _EXECUCAO_LOCK.acquire(timeout=1)
    if not acquired:
        mensagem = "Ja existe uma execucao de abertura de OS em andamento."
        _log_db(db, "aviso", mensagem, execucao_id, usuario_id)
        return {
            "status": "ocupado",
            "execucao_id": execucao_id,
            "sucesso": [],
            "falha": [{"motivo": mensagem}],
        }

    try:
        _atualizar_disparo_rotina(db, rotina_id)

        if not itens:
            _log_db(
                db,
                "info",
                f"Nenhuma OS pendente para processar ({origem}).",
                execucao_id,
                usuario_id,
            )
            return {
                "status": "sem_itens",
                "execucao_id": execucao_id,
                "sucesso": [],
                "falha": [],
            }

        _log_db(
            db,
            "info",
            f"Iniciando abertura automatica de OS ({origem}) com {len(itens)} item(ns).",
            execucao_id,
            usuario_id,
        )

        config_geral = _carregar_configuracao_geral(db)
        clientes_por_id, clientes_por_nome = _carregar_clientes(db)

        itens_execucao: list[dict[str, Any]] = []
        falhas_pre_execucao: list[dict[str, Any]] = []

        for item in itens:
            try:
                cliente = _resolver_cliente(item, clientes_por_id, clientes_por_nome)
                itens_execucao.append(_montar_item_execucao(item, cliente, config_geral))
            except Exception as exc:
                erro = {**item, "motivo": str(exc)}
                falhas_pre_execucao.append(erro)
                _log_db(
                    db,
                    "erro",
                    f'Falha de configuracao para "{item.get("empresa") or item.get("cliente") or "registro"}".',
                    execucao_id,
                    usuario_id,
                    detalhe=str(exc),
                )

        resultado_rpa = {"sucesso": [], "falha": []}
        if itens_execucao:
            resultado_rpa = executar_fluxo_completo(itens_execucao, config=config_geral)
            if not resultado_rpa.get("sucesso") and not resultado_rpa.get("falha"):
                resultado_rpa = {
                    "sucesso": [],
                    "falha": [
                        {
                            **item,
                            "motivo": (
                                "A automacao encerrou sem retornar sucesso ou falha. "
                                "Verifique os logs do backend/browser."
                            ),
                        }
                        for item in itens_execucao
                    ],
                }

        sucessos = [_limpar_item_saida(item) for item in resultado_rpa.get("sucesso", [])]
        falhas_execucao = [_limpar_item_saida(item) for item in resultado_rpa.get("falha", [])]
        falhas = falhas_pre_execucao + falhas_execucao

        _marcar_status_apontamentos(
            db,
            sucessos,
            "OS Aberta",
            limpar_observacao_rpa=True,
        )
        _registrar_falhas_apontamentos(db, falhas)

        for erro in falhas:
            ticket = _coalesce(erro.get("ticket"), "sem ticket")
            empresa = _coalesce(erro.get("empresa"), erro.get("cliente"), "empresa desconhecida")
            _log_db(
                db,
                "erro",
                f'Falha ao abrir OS "{ticket}" para "{empresa}".',
                execucao_id,
                usuario_id,
                detalhe=str(erro.get("motivo") or "Motivo nao informado."),
            )

        _log_db(
            db,
            "sucesso" if not falhas else "aviso",
            (
                f"Execucao finalizada ({origem}). "
                f"Sucesso: {len(sucessos)} | Falha: {len(falhas)}"
            ),
            execucao_id,
            usuario_id,
        )

        return {
            "status": "ok",
            "execucao_id": execucao_id,
            "sucesso": sucessos,
            "falha": falhas,
        }
    finally:
        _EXECUCAO_LOCK.release()
