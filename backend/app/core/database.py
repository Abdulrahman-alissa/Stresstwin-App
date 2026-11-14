from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from app.core.config import get_settings
from functools import lru_cache

settings = get_settings()

# Bound every PostgREST call so a stalled connection fails fast (and can be retried by
# app.core.db_retry.run) instead of hanging a request worker.
POSTGREST_TIMEOUT_SECONDS = 10


def _options() -> ClientOptions:
    return ClientOptions(postgrest_client_timeout=POSTGREST_TIMEOUT_SECONDS)


@lru_cache()
def get_supabase() -> Client:
    """Anon client — respects Row Level Security (user requests)."""
    return create_client(settings.supabase_url, settings.supabase_anon_key, options=_options())


@lru_cache()
def get_supabase_admin() -> Client:
    """Service-role client — bypasses RLS (scheduler / admin tasks only)."""
    return create_client(settings.supabase_url, settings.supabase_service_key, options=_options())
