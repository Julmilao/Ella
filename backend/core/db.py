from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from core.env import get_required_env, load_local_env

load_local_env()


@lru_cache(maxsize=1)
def get_db() -> Client:
    supabase_url = get_required_env("SUPABASE_URL")
    supabase_service_key = get_required_env("SUPABASE_SERVICE_KEY")
    return create_client(supabase_url, supabase_service_key)
