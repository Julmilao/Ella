from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

from core.db import get_db
from core.pdf_generator import gerar_status_report
from core.timezone_utils import hoje_brasilia
from scheduler import email_sender

logger = logging.getLogger(__name__)


# ── Period helpers ─────────────────────────────────────────────────────────────

def _compute_periodo(periodo: str) -> tuple[date, date]:
    """
    Return (periodo_inicio, periodo_fim) for the given period type.
    All dates are relative to today.
    """
    today = hoje_brasilia()
    periodo = (periodo or "mensal").lower()

    if periodo == "mensal":
        inicio = today.replace(day=1)
        ultimo_dia = monthrange(today.year, today.month)[1]
        fim = today.replace(day=ultimo_dia)
        return inicio, fim

    if periodo == "quinzenal":
        inicio = today - timedelta(days=14)
        return inicio, today

    if periodo == "semanal":
        inicio = today - timedelta(days=6)
        return inicio, today

    # Fallback to monthly
    logger.warning("_compute_periodo: periodo desconhecido '%s' — usando mensal.", periodo)
    inicio = today.replace(day=1)
    ultimo_dia = monthrange(today.year, today.month)[1]
    fim = today.replace(day=ultimo_dia)
    return inicio, fim


# ── Default template ───────────────────────────────────────────────────────────

_DEFAULT_TEMPLATE = """\
<html>
<body>
<p>Olá,</p>

<p>Segue o relatório de Status Report para o período de
<strong>{{periodo_inicio}}</strong> a <strong>{{periodo_fim}}</strong>.</p>

<ul>
  <li><strong>Cliente:</strong> {{cliente}}</li>
  <li><strong>Total de OS:</strong> {{total_os}}</li>
  <li><strong>Horas consumidas:</strong> {{horas_consumidas}}</li>
  <li><strong>Saldo restante:</strong> {{saldo_restante}}</li>
</ul>

<p>Atenciosamente,<br>{{nome_empresa}}</p>
</body>
</html>
"""


def _safe_pdf_filename(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in value.strip())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned or "status_report"


def _fill_template(template: str, variables: dict[str, str]) -> str:
    """Replace all {{key}} placeholders with the corresponding value."""
    result = template
    for key, value in variables.items():
        result = result.replace("{{" + key + "}}", str(value))
    return result


# ── Logging helper ─────────────────────────────────────────────────────────────

def _log_db(
    db,
    tipo: str,
    mensagem: str,
    execucao_id: Optional[str] = None,
) -> None:
    """Insert a record into the `logs` table. Never raises."""
    try:
        payload: dict = {
            "modulo": "status_report",
            "tipo": tipo,
            "mensagem": mensagem,
        }
        if execucao_id:
            payload["execucao_id"] = execucao_id
        db.table("logs").insert(payload).execute()
    except Exception:
        logger.exception("_log_db: nao foi possivel registrar log no banco.")


# ── Main entry point ───────────────────────────────────────────────────────────

def processar(config: dict) -> None:  # noqa: C901  (complexity accepted — one clear flow)
    """
    Process a single status_report_configs entry:

    1.  Compute the period window.
    2.  Fetch solicitacoes_os for that client + window.
    3.  Skip if empty and enviar_sem_os is False.
    4.  Fetch SMTP config and e-mail template.
    5.  Fill template variables.
    6.  Create sr_envios record (status='pendente').
    7.  Fetch active destinatários.
    8.  Send e-mail.
    9.  Insert sr_envio_destinatarios rows.
    10. Update sr_envios status.
    11. Log to `logs` table.
    """
    config_id: str = config.get("id", "desconhecido")
    cliente_id: str = config.get("cliente_id", "")
    periodo: str = config.get("periodo") or "mensal"

    logger.info("status_report.processar: iniciando config_id=%s", config_id)

    db = get_db()
    envio_id: Optional[str] = None

    try:
        # ── 1. Period window ───────────────────────────────────────────────────
        periodo_inicio, periodo_fim = _compute_periodo(periodo)
        inicio_str = periodo_inicio.isoformat()
        fim_str = periodo_fim.isoformat()
        logger.info(
            "status_report: periodo %s — %s a %s", periodo, inicio_str, fim_str
        )

        # ── 2. Fetch solicitacoes_os ───────────────────────────────────────────
        try:
            res_ap = (
                db.table("solicitacoes_os")
                .select("*")
                .eq("cliente_id", cliente_id)
                .gt("horas_executadas", 0)
                .gte("data_os", inicio_str)
                .lte("data_os", fim_str)
                .order("data_os")
                .order("hora_inicio")
                .execute()
            )
            apontamentos = res_ap.data or []
        except Exception as exc:
            logger.exception(
                "status_report: erro ao buscar apontamentos para config %s.", config_id
            )
            _log_db(db, "erro", f"Erro ao buscar apontamentos: {exc}", envio_id)
            return

        total_os: int = len(apontamentos)
        horas_consumidas: float = sum(
            float(a.get("horas_executadas") or 0) for a in apontamentos
        )

        # ── 3. Skip if no OS and flag is False ────────────────────────────────
        if not config.get("enviar_sem_os", False) and total_os == 0:
            logger.info(
                "status_report: config %s ignorada — sem OS no periodo e enviar_sem_os=False.",
                config_id,
            )
            return

        # ── 4a. SMTP config ───────────────────────────────────────────────────
        try:
            res_smtp = db.table("configuracoes_gerais").select("*").limit(1).execute()
            smtp_config: dict = res_smtp.data[0] if res_smtp.data else {}
        except Exception as exc:
            logger.exception(
                "status_report: erro ao buscar configuracoes_gerais para config %s.", config_id
            )
            _log_db(db, "erro", f"Erro ao buscar configuracoes_gerais: {exc}", envio_id)
            return

        nome_empresa: str = smtp_config.get("pdf_nome_empresa") or "ELLA OS"

        # ── 4b. E-mail template ───────────────────────────────────────────────
        template_html: str = _DEFAULT_TEMPLATE
        assunto: str = f"Status Report — {nome_empresa}"

        if config.get("modelo_id"):
            try:
                res_modelo = (
                    db.table("modelos_email")
                    .select("*")
                    .eq("id", config["modelo_id"])
                    .maybe_single()
                    .execute()
                )
                if res_modelo.data:
                    template_html = res_modelo.data.get("corpo") or _DEFAULT_TEMPLATE
                    assunto = res_modelo.data.get("assunto") or assunto
                else:
                    logger.warning(
                        "status_report: modelo_id %s nao encontrado — usando template padrao.",
                        config["modelo_id"],
                    )
            except Exception:
                logger.exception(
                    "status_report: erro ao buscar modelo_id %s — usando template padrao.",
                    config.get("modelo_id"),
                )

        # ── 5. Fill template variables ────────────────────────────────────────
        nome_cliente: str = cliente_id
        try:
            res_cli = (
                db.table("clientes")
                .select("nome")
                .eq("id", cliente_id)
                .maybe_single()
                .execute()
            )
            if res_cli.data:
                nome_cliente = res_cli.data.get("nome") or cliente_id
        except Exception:
            logger.warning(
                "status_report: nao foi possivel buscar nome do cliente %s.", cliente_id
            )

        corpo = _fill_template(
            template_html,
            {
                "cliente": nome_cliente,
                "periodo_inicio": inicio_str,
                "periodo_fim": fim_str,
                "total_os": str(total_os),
                "horas_consumidas": f"{horas_consumidas:.2f}",
                "saldo_restante": "—",
                "nome_empresa": nome_empresa,
            },
        )

        # ── 5b. Generate PDF from the same client-scoped apontamentos ─────────
        pdf_bytes = gerar_status_report(
            nome_empresa=nome_empresa,
            nome_cliente=nome_cliente,
            periodo_inicio=inicio_str,
            periodo_fim=fim_str,
            apontamentos=apontamentos,
            cabecalho=smtp_config.get("pdf_cabecalho"),
            rodape=smtp_config.get("pdf_rodape"),
        )
        pdf_filename = f"{_safe_pdf_filename(nome_cliente)}_{inicio_str}_{fim_str}.pdf"
        if pdf_bytes is None:
            logger.warning(
                "status_report: PDF nao foi gerado para config %s (cliente %s).",
                config_id,
                cliente_id,
            )
            _log_db(
                db,
                "aviso",
                f"PDF nao foi gerado para o cliente {nome_cliente}. O e-mail sera enviado sem anexo.",
                envio_id,
            )

        # ── 6. Create sr_envios record ────────────────────────────────────────
        try:
            res_envio = (
                db.table("sr_envios")
                .insert(
                    {
                        "config_id": config_id,
                        "periodo_inicio": inicio_str,
                        "periodo_fim": fim_str,
                        "status": "pendente",
                    }
                )
                .execute()
            )
            envio_id = res_envio.data[0]["id"] if res_envio.data else None
            logger.info("status_report: sr_envios criado id=%s", envio_id)
        except Exception as exc:
            logger.exception(
                "status_report: erro ao criar sr_envios para config %s.", config_id
            )
            _log_db(db, "erro", f"Erro ao criar sr_envios: {exc}")
            return

        # ── 7. Active destinatários ───────────────────────────────────────────
        try:
            res_dest = (
                db.table("sr_destinatarios")
                .select("email")
                .eq("config_id", config_id)
                .eq("ativo", True)
                .execute()
            )
            destinatarios = res_dest.data or []
        except Exception as exc:
            logger.exception(
                "status_report: erro ao buscar destinatarios para config %s.", config_id
            )
            _log_db(db, "erro", f"Erro ao buscar destinatarios: {exc}", envio_id)
            _set_envio_status(db, envio_id, "erro", str(exc))
            return

        to_emails = [d["email"] for d in destinatarios if d.get("email")]

        if not to_emails:
            logger.warning(
                "status_report: config %s sem destinatarios ativos — abortando.", config_id
            )
            _log_db(
                db,
                "erro",
                "Nenhum destinatario ativo encontrado.",
                envio_id,
            )
            _set_envio_status(db, envio_id, "erro", "Nenhum destinatario ativo.")
            return

        # ── 8. Send e-mail ────────────────────────────────────────────────────
        resultado = email_sender.send_email(
            smtp_config=smtp_config,
            to_emails=to_emails,
            subject=assunto,
            body=corpo,
            pdf_path=None,
            pdf_bytes=pdf_bytes,
            pdf_filename=pdf_filename,
        )

        # ── 9. Insert sr_envio_destinatarios ──────────────────────────────────
        for email in to_emails:
            if email in resultado["sucesso"]:
                status_entrega = "enviado"
                erro_entrega = None
            else:
                status_entrega = "erro"
                erro_entrega = resultado["erro"].get(email)

            try:
                row: dict = {
                    "envio_id": envio_id,
                    "email": email,
                    "status_entrega": status_entrega,
                }
                if erro_entrega:
                    row["erro_msg"] = erro_entrega
                db.table("sr_envio_destinatarios").insert(row).execute()
            except Exception:
                logger.exception(
                    "status_report: erro ao inserir sr_envio_destinatarios para %s.", email
                )

        # ── 10. Update sr_envios final status ─────────────────────────────────
        todos_falharam = len(resultado["sucesso"]) == 0
        if todos_falharam:
            erros_resumo = "; ".join(
                f"{e}: {m}" for e, m in resultado["erro"].items()
            )
            _set_envio_status(db, envio_id, "erro", erros_resumo)
            logger.error(
                "status_report: todos os envios falharam para config %s.", config_id
            )
        else:
            _set_envio_status(db, envio_id, "enviado")
            logger.info(
                "status_report: envio concluido — sucesso=%d erro=%d",
                len(resultado["sucesso"]),
                len(resultado["erro"]),
            )

        # ── 11. Log to `logs` table ───────────────────────────────────────────
        if todos_falharam:
            _log_db(
                db,
                "erro",
                f"Status Report enviado com falha total. Config: {config_id}.",
                envio_id,
            )
        else:
            _log_db(
                db,
                "sucesso",
                (
                    f"Status Report disparado. Config: {config_id}. "
                    f"Periodo: {inicio_str} a {fim_str}. "
                    f"OS: {total_os}. "
                    f"Enviados: {len(resultado['sucesso'])}. "
                    f"Erros: {len(resultado['erro'])}."
                ),
                envio_id,
            )

    except Exception as exc:
        logger.exception(
            "status_report: erro inesperado ao processar config %s.", config_id
        )
        try:
            _log_db(
                db,
                "erro",
                f"Erro inesperado ao processar config {config_id}: {exc}",
                envio_id,
            )
            if envio_id:
                _set_envio_status(db, envio_id, "erro", str(exc))
        except Exception:
            logger.exception(
                "status_report: nao foi possivel registrar erro no banco para config %s.",
                config_id,
            )


# ── Internal utility ───────────────────────────────────────────────────────────

def _set_envio_status(
    db,
    envio_id: Optional[str],
    status: str,
    erro_msg: Optional[str] = None,
) -> None:
    """Update the status (and optional error message) of an sr_envios row."""
    if not envio_id:
        return
    try:
        payload: dict = {"status": status}
        if erro_msg:
            payload["erro_msg"] = erro_msg
        db.table("sr_envios").update(payload).eq("id", envio_id).execute()
    except Exception:
        logger.exception(
            "_set_envio_status: nao foi possivel atualizar status do envio %s.", envio_id
        )
