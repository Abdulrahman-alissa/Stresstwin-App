"""
Small, explicit helpers for talking to Supabase/PostgREST.

* run()        – retry an idempotent READ a few times, but only for transient *network* failures
                 (timeouts, connection resets). PostgREST/API errors (bad query, RLS, constraint
                 violations …) are NOT retried and are never swallowed.
* first_row()  – "zero or one row" lookup that works regardless of how PostgREST answers an empty
                 result. It replaces `.maybe_single()`, which in postgrest-py 0.16 raises
                 APIError("Missing response", code "204") (or returns None) when no row matches.
When the database stays unreachable, run() raises DatabaseUnavailable so the caller can answer 503
instead of inventing data.
"""
import logging
import time
from typing import Callable, TypeVar

import httpx

log = logging.getLogger("stresstwin.db")
T = TypeVar("T")

# Transient, safe-to-retry transport errors only.
TRANSIENT_ERRORS = (
    httpx.TimeoutException,        # ReadTimeout, ConnectTimeout, WriteTimeout, PoolTimeout
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)


class DatabaseUnavailable(Exception):
    """The database could not be reached after the allowed retries."""


def run(fn: Callable[[], T], *, attempts: int = 3, base_delay: float = 0.25,
        sleep: Callable[[float], None] = time.sleep, what: str = "query") -> T:
    """Call fn() (an idempotent read). Retry transient transport errors with short backoff."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except TRANSIENT_ERRORS as e:
            last = e
            log.warning("transient database error on %s (attempt %d/%d): %s: %s",
                        what, i + 1, attempts, type(e).__name__, e)
            if i < attempts - 1:
                sleep(base_delay * (2 ** i))
    raise DatabaseUnavailable(f"{what} failed after {attempts} attempts: {type(last).__name__}") from last


def first_row(builder) -> dict | None:
    """Return the first matching row or None. `builder` is a select query with filters applied."""
    rows = builder.limit(1).execute().data or []
    return rows[0] if rows else None
