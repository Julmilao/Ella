from __future__ import annotations

import os
from pathlib import Path

_ENV_LOADED = False


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()

    if not key:
        return None

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]

    return key, value


def load_local_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return

    backend_dir = Path(__file__).resolve().parents[1]
    repo_dir = Path(__file__).resolve().parents[2]

    for env_file in (backend_dir / ".env", repo_dir / ".env"):
        if not env_file.exists():
            continue

        for line in env_file.read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(line)
            if not parsed:
                continue
            key, value = parsed
            os.environ.setdefault(key, value)

    aliases = {
        "SUPABASE_URL": "VITE_SUPABASE_URL",
        "SUPABASE_ANON_KEY": "VITE_SUPABASE_PUBLISHABLE_KEY",
    }

    for target, source in aliases.items():
        if not os.environ.get(target) and os.environ.get(source):
            os.environ[target] = os.environ[source]

    _ENV_LOADED = True


def get_env(name: str, default: str | None = None) -> str | None:
    load_local_env()
    value = os.environ.get(name)
    if value is None:
        return default

    stripped = value.strip()
    return stripped if stripped else default


def get_required_env(name: str) -> str:
    value = get_env(name)
    if value is None:
        raise RuntimeError(f"Variavel de ambiente obrigatoria ausente: {name}")
    return value


def resolve_path(path_value: str, *, base_dir: Path | None = None) -> Path:
    path = Path(path_value).expanduser()
    if not path.is_absolute():
        path = (base_dir or Path.cwd()) / path
    return path.resolve()


def get_cors_allow_origins(default: list[str] | tuple[str, ...] | None = None) -> list[str]:
    raw = get_env("CORS_ALLOW_ORIGINS")
    if raw:
        origins = [item.strip() for item in raw.split(",") if item.strip()]
        if origins:
            return origins

    return list(default or ["http://localhost:8080", "http://127.0.0.1:8080"])
