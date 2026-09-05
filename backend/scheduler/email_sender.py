from __future__ import annotations

import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def send_email(
    smtp_config: dict,
    to_emails: list[str],
    subject: str,
    body: str,
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    pdf_filename: Optional[str] = None,
) -> dict:
    """
    Send an e-mail to each address in *to_emails* individually.

    smtp_config keys (all from configuracoes_gerais):
        smtp_host, smtp_porta, smtp_usuario, smtp_senha,
        smtp_de_nome, smtp_usar_tls

    Returns:
        {
            "sucesso": [list of addresses that succeeded],
            "erro":    {address: reason_string, ...},
        }
    """
    host: str = smtp_config.get("smtp_host", "")
    porta: int = int(smtp_config.get("smtp_porta") or 587)
    usuario: str = smtp_config.get("smtp_usuario", "")
    senha: str = smtp_config.get("smtp_senha", "")
    de_nome: str = smtp_config.get("smtp_de_nome") or usuario
    usar_tls: bool = bool(smtp_config.get("smtp_usar_tls", True))

    resultado: dict = {"sucesso": [], "erro": {}}

    # Build optional PDF attachment bytes once (shared across recipients)
    attachment_bytes = pdf_bytes
    attachment_filename = pdf_filename or "relatorio.pdf"
    if attachment_bytes is None and pdf_path:
        try:
            p = Path(pdf_path)
            attachment_bytes = p.read_bytes()
            attachment_filename = p.name
        except Exception as exc:
            logger.warning("email_sender: nao foi possivel ler o PDF '%s': %s", pdf_path, exc)

    for email in to_emails:
        try:
            msg = MIMEMultipart()
            msg["From"] = f"{de_nome} <{usuario}>"
            msg["To"] = email
            msg["Subject"] = subject

            msg.attach(MIMEText(body, "html", "utf-8"))

            if attachment_bytes:
                part = MIMEApplication(attachment_bytes, _subtype="pdf")
                part.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=attachment_filename,
                )
                msg.attach(part)

            if usar_tls:
                with smtplib.SMTP(host, porta, timeout=30) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    server.login(usuario, senha)
                    server.sendmail(usuario, [email], msg.as_bytes())
            else:
                with smtplib.SMTP_SSL(host, porta, timeout=30) as server:
                    server.login(usuario, senha)
                    server.sendmail(usuario, [email], msg.as_bytes())

            logger.info("email_sender: e-mail enviado com sucesso para %s.", email)
            resultado["sucesso"].append(email)

        except Exception as exc:
            reason = str(exc)
            logger.error("email_sender: falha ao enviar para %s — %s", email, reason)
            resultado["erro"][email] = reason

    return resultado
