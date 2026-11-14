from supabase import create_client, Client
from app.core.config import get_settings
from functools import lru_cache

settings = get_settings()


@lru_cache()
def get_supabase() -> Client:
    """Anon client — respects Row Level Security (user requests)."""
    return create_client(settings.supabase_url, settings.supabase_anon_key)


@lru_cache()
def get_supabase_admin() -> Client:
    """Service-role client — bypasses RLS (scheduler / admin tasks only)."""
    return create_client(settings.supabase_url, settings.supabase_service_key)
