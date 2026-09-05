from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


BRASILIA_TZ_NAME = "America/Sao_Paulo"


def _build_brasilia_tz():
    if ZoneInfo is not None:
        try:
            return ZoneInfo(BRASILIA_TZ_NAME)
        except Exception:
            pass

    return timezone(timedelta(hours=-3), name=BRASILIA_TZ_NAME)


BRASILIA_TZ = _build_brasilia_tz()


def agora_brasilia() -> datetime:
    return datetime.now(BRASILIA_TZ)


def hoje_brasilia() -> date:
    return agora_brasilia().date()
