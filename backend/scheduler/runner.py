from __future__ import annotations

import json
import logging
from datetime import datetime
from threading import RLock
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler

from core.db import get_db
from core.timezone_utils import BRASILIA_TZ, BRASILIA_TZ_NAME
from scheduler.tasks import lancamento_os, status_report

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler(timezone=BRASILIA_TZ)
_reload_lock = RLock()


def _parse_horarios(row: dict) -> list[str]:
    raw = row.get("horarios_dia")
    if raw:
        if isinstance(raw, list):
            times = [h for h in raw if isinstance(h, str) and h]
        elif isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                times = [h for h in parsed if isinstance(h, str) and h]
            except Exception:
                times = []
        else:
            times = []
        if times:
            return times

    fallback = str(row.get("scheduler_hora") or "08:00")
    return [fallback]


def _parse_hora_minuto(horario: str) -> tuple[int, int]:
    try:
        hour, minute = (int(x) for x in str(horario).split(":"))
        return hour, minute
    except ValueError:
        return 8, 0


def _job_id(modelo_id: int, sufixo: str) -> str:
    safe = str(sufixo).replace(":", "").replace(",", "_")
    return f"modelo_{modelo_id}_{safe}"


def _carregar_modelo(modelo_id: int) -> dict | None:
    try:
        db = get_db()
        res = (
            db.table("modelos_rotina")
            .select("*")
            .eq("id", modelo_id)
            .maybe_single()
            .execute()
        )
        return res.data
    except Exception:
        logger.exception("Scheduler: erro ao carregar modelo %s.", modelo_id)
        return None


def _disparar_status_report(modelo_id: int) -> None:
    logger.info("Scheduler: disparando status_report modelo_id=%s", modelo_id)
    try:
        db = get_db()
        res = (
            db.table("status_report_configs")
            .select("*")
            .eq("ativo", True)
            .eq("modelo_rotina_id", modelo_id)
            .execute()
        )
        configs = res.data or []
    except Exception:
        logger.exception("Scheduler: erro ao buscar configs para modelo %s.", modelo_id)
        return

    if not configs:
        try:
            db = get_db()
            res = db.table("status_report_configs").select("*").eq("ativo", True).execute()
            configs = res.data or []
        except Exception:
            logger.exception("Scheduler: erro ao buscar todas as configs.")
            return

    for config in configs:
        try:
            status_report.processar(config)
        except Exception:
            logger.exception("Scheduler: erro ao processar config %s.", config.get("id"))


def _disparar_modelo(modelo_id: int) -> None:
    modelo = _carregar_modelo(modelo_id)
    if not modelo:
        logger.warning("Scheduler: modelo %s nao encontrado.", modelo_id)
        return
    if not modelo.get("ativo", True):
        logger.info("Scheduler: modelo %s inativo, disparo ignorado.", modelo_id)
        return

    tipo = str(modelo.get("tipo") or "status_report").lower()
    logger.info("Scheduler: disparando modelo_id=%s tipo=%s", modelo_id, tipo)

    if tipo == "lancamento_os":
        lancamento_os.processar(modelo)
        return

    _disparar_status_report(modelo_id)


def _registrar_job(trigger: str, job_id: str, modelo_id: int, **kwargs) -> None:
    _scheduler.add_job(
        _disparar_modelo,
        trigger=trigger,
        args=[modelo_id],
        id=job_id,
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=300,
        max_instances=1,
        **kwargs,
    )


def reload_jobs() -> dict:
    with _reload_lock:
        if not _scheduler.running:
            logger.warning("reload_jobs: scheduler nao esta rodando.")
            return {"status": "scheduler_not_running", "jobs_added": 0, "jobs_removed": 0}

        try:
            db = get_db()
            res = db.table("modelos_rotina").select("*").eq("ativo", True).execute()
            modelos = res.data or []
        except Exception:
            logger.exception("reload_jobs: erro ao buscar modelos_rotina.")
            return {"status": "error", "jobs_added": 0, "jobs_removed": 0}

        desired_ids: set[str] = set()
        added = 0

        for modelo in modelos:
            modelo_id = modelo["id"]
            tipo_agendamento = str(modelo.get("tipo_agendamento") or "horarios_fixos").lower()

            if tipo_agendamento == "intervalo":
                minutos = max(int(modelo.get("intervalo_minutos") or 60), 1)
                job_id = _job_id(modelo_id, f"intervalo_{minutos}")
                desired_ids.add(job_id)
                _registrar_job("interval", job_id, modelo_id, minutes=minutos)
                logger.info("reload_jobs: job '%s' registrado (intervalo %s min).", job_id, minutos)
                added += 1
                continue

            horarios = _parse_horarios(modelo)

            if tipo_agendamento == "periodo":
                horario = horarios[0]
                hour, minute = _parse_hora_minuto(horario)
                job_id = _job_id(modelo_id, f"periodo_{horario}")
                desired_ids.add(job_id)

                periodo = str(modelo.get("periodo") or "mensal").lower()
                dia_envio = int(modelo.get("dia_envio") or 1)

                if periodo == "semanal":
                    _registrar_job(
                        "cron",
                        job_id,
                        modelo_id,
                        day_of_week=max(0, min(dia_envio, 6)),
                        hour=hour,
                        minute=minute,
                    )
                elif periodo == "quinzenal":
                    dias = [max(1, min(dia_envio, 28))]
                    segundo_dia = dia_envio + 14
                    if segundo_dia <= 28:
                        dias.append(segundo_dia)
                    _registrar_job(
                        "cron",
                        job_id,
                        modelo_id,
                        day=",".join(str(dia) for dia in dias),
                        hour=hour,
                        minute=minute,
                    )
                else:
                    _registrar_job(
                        "cron",
                        job_id,
                        modelo_id,
                        day=max(1, min(dia_envio, 28)),
                        hour=hour,
                        minute=minute,
                    )

                logger.info("reload_jobs: job '%s' registrado (periodo %s %s).", job_id, periodo, horario)
                added += 1
                continue

            # horarios_fixos: frequência controlada pelo campo `periodo`
            periodo_fixo = str(modelo.get("periodo") or "diario").lower()

            for horario in horarios:
                job_id = _job_id(modelo_id, f"{periodo_fixo}_{horario}")
                desired_ids.add(job_id)
                hour, minute = _parse_hora_minuto(horario)

                if periodo_fixo == "semanal":
                    # Toda segunda-feira (day_of_week=0)
                    _registrar_job(
                        "cron", job_id, modelo_id,
                        day_of_week=0,
                        hour=hour, minute=minute,
                    )
                elif periodo_fixo == "quinzenal":
                    # Dias 1 e 15 de cada mês
                    _registrar_job(
                        "cron", job_id, modelo_id,
                        day="1,15",
                        hour=hour, minute=minute,
                    )
                elif periodo_fixo == "mensal":
                    # Dia 1 de cada mês
                    _registrar_job(
                        "cron", job_id, modelo_id,
                        day=1,
                        hour=hour, minute=minute,
                    )
                else:
                    # "diario" ou qualquer outro valor → todo dia
                    _registrar_job(
                        "cron", job_id, modelo_id,
                        hour=hour, minute=minute,
                    )

                logger.info(
                    "reload_jobs: job '%s' registrado (horarios_fixos %s %s).",
                    job_id, periodo_fixo, horario,
                )
                added += 1

        removed = 0
        for job in _scheduler.get_jobs():
            if job.id.startswith("modelo_") and job.id not in desired_ids:
                _scheduler.remove_job(job.id)
                logger.info("reload_jobs: job obsoleto '%s' removido.", job.id)
                removed += 1

        logger.info("reload_jobs: %d job(s) registrado(s), %d removido(s).", added, removed)
        return {
            "status": "ok",
            "jobs_added": added,
            "jobs_removed": removed,
            "modelos": len(modelos),
        }


def start() -> None:
    _scheduler.start()
    logger.info("Scheduler iniciado. timezone=%s", BRASILIA_TZ_NAME)
    reload_jobs()


def stop() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler encerrado.")


def get_jobs_info() -> list[dict]:
    jobs = []
    for job in _scheduler.get_jobs():
        next_run: Optional[datetime] = job.next_run_time
        next_run_brasilia: Optional[datetime] = None
        if next_run:
            next_run_brasilia = (
                next_run.replace(tzinfo=BRASILIA_TZ)
                if next_run.tzinfo is None
                else next_run.astimezone(BRASILIA_TZ)
            )
        jobs.append(
            {
                "id": job.id,
                "nome": job.id,
                "trigger": str(job.trigger),
                "proximo": next_run_brasilia.isoformat() if next_run_brasilia else None,
            }
        )
    return jobs
