"""
Regression tests for two production errors.

 1. POST /api/devices/register -> APIError {'message': 'Missing response', 'code': '204'}
    Root cause: the lookup used postgrest-py's `.maybe_single()`, which raises that error (or returns None)
    whenever the query matches no row / the server answers 204 with an empty body - i.e. on a device's
    FIRST registration. These tests run the REAL postgrest-py client against a mocked HTTP server.
 2. GET /api/forecast/3day -> httpx.ReadTimeout from db.table("users")...execute()
    Fix: bounded client timeout, a few retries for transient network errors only, and a 503 when the
    database stays unreachable (never an invented forecast).

Run from the backend root:  python -m unittest tests.test_backend_errors -v
"""
import asyncio, json, os, sys, unittest
from pathlib import Path
from urllib.parse import parse_qs

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_JWT_SECRET", "SECRET_KEY"):
    os.environ.setdefault(k, "test")

from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError
from fastapi import HTTPException

from tests.fakedb import FakeDB
from app.core import db_retry
from app.core.db_retry import run, first_row, DatabaseUnavailable

UID = "11111111-1111-1111-1111-111111111111"


# ───────────────────────── a tiny PostgREST stand-in speaking real HTTP semantics ─────────────────────────
class FakePostgrest:
    """Handles /devices for GET (select), POST (upsert/insert). `post_mode` controls the write response."""
    def __init__(self, post_mode="representation", get_empty_as="406"):
        self.rows, self.post_mode, self.get_empty_as, self.requests = [], post_mode, get_empty_as, []

    def _filters(self, params):
        out = {}
        for k, v in params.items():
            if k in ("select", "limit", "on_conflict", "order"): continue
            out[k] = v[0].split(".", 1)[1] if v[0].startswith("eq.") else v[0]
        return out

    def handler(self, request: httpx.Request) -> httpx.Response:
        params = parse_qs(request.url.query.decode())
        self.requests.append((request.method, dict(params), dict(request.headers)))
        if request.method == "GET":
            f = self._filters(params)
            hit = [r for r in self.rows if all(str(r.get(k)) == v for k, v in f.items())]
            single = "vnd.pgrst.object" in request.headers.get("accept", "")
            if single:
                if hit: return httpx.Response(200, json=hit[0])
                if self.get_empty_as == "204": return httpx.Response(204)             # empty body
                if self.get_empty_as == "406-nodetails":                               # 0 rows, but no recognisable "details" text
                    return httpx.Response(406, json={"code": "PGRST116", "message": "JSON object requested, multiple (or no) rows returned"})
                return httpx.Response(406, json={"code": "PGRST116", "message": "JSON object requested, multiple (or no) rows returned",
                                                 "details": "The result contains 0 rows", "hint": None})
            return httpx.Response(200, json=hit)
        if request.method == "POST":
            body = json.loads(request.content)
            body = body if isinstance(body, list) else [body]
            merge = "merge-duplicates" in request.headers.get("prefer", "")
            out = []
            for b in body:
                same = [r for r in self.rows if r["user_id"] == b["user_id"] and r["device_id"] == b["device_id"]]
                if same and not merge:
                    return httpx.Response(409, json={"code": "23505", "message": "duplicate key value violates unique constraint", "details": None, "hint": None})
                if same: same[0].update(b); out.append(same[0])
                else:
                    row = {"id": f"pk-{len(self.rows)+1}", "keyboard_active": False, "last_snapshot_at": None, "last_sync_at": None, **b}
                    self.rows.append(row); out.append(row)
            if self.post_mode == "empty204": return httpx.Response(204)
            return httpx.Response(201, json=out)
        return httpx.Response(405)


class PgDB:
    """supabase-style facade over the REAL postgrest-py client."""
    def __init__(self, server: FakePostgrest):
        self.server = server
        self.client = SyncPostgrestClient("http://pg.test/rest/v1", headers={})
        self.client.session = httpx.Client(base_url="http://pg.test/rest/v1", transport=httpx.MockTransport(server.handler))
    def table(self, name): return self.client.from_(name)


def register(db, device_id="dev-1", platform="android", name="Pixel"):
    from app.api import devices
    from app.schemas.behavioral import DeviceRegisterRequest
    orig = devices.get_supabase_admin
    devices.get_supabase_admin = lambda: db
    try:
        body = DeviceRegisterRequest(device_id=device_id, platform=platform, display_name=name)
        return asyncio.run(devices.register_device(body, {"sub": UID}))
    finally:
        devices.get_supabase_admin = orig


# ───────────────────────── Error 1: device registration ─────────────────────────
class TestDeviceRegistration(unittest.TestCase):
    def test_root_cause_maybe_single_is_unreliable_on_an_empty_result(self):
        """Documents the bug with the real postgrest-py 0.16 client: .maybe_single() either raises
        APIError('Missing response', '204') or returns None (-> AttributeError on .data) when no row matches."""
        db = PgDB(FakePostgrest(get_empty_as="406-nodetails"))
        with self.assertRaises(APIError) as cm:
            db.table("devices").select("*").eq("user_id", UID).eq("device_id", "new").maybe_single().execute()
        self.assertEqual((cm.exception.code, cm.exception.message), ("204", "Missing response"))
        db = PgDB(FakePostgrest(get_empty_as="406"))
        res = db.table("devices").select("*").eq("user_id", UID).eq("device_id", "new").maybe_single().execute()
        self.assertIsNone(res)                                         # old code then did `existing.data` -> AttributeError

    def test_first_row_handles_both_empty_response_styles(self):
        for style in ("204", "406", "406-nodetails"):
            db = PgDB(FakePostgrest(get_empty_as=style))
            self.assertIsNone(first_row(db.table("devices").select("*").eq("device_id", "x")), style)

    def test_first_registration_succeeds(self):
        for style in ("204", "406", "406-nodetails"):
            srv = FakePostgrest(get_empty_as=style)
            out = register(PgDB(srv))
            self.assertEqual((out.device_id, out.platform, out.display_name), ("dev-1", "android", "Pixel"))
            self.assertEqual(len(srv.rows), 1)

    def test_upsert_targets_the_unique_key(self):
        srv = FakePostgrest(); register(PgDB(srv))
        method, params, headers = [r for r in srv.requests if r[0] == "POST"][0]
        self.assertEqual(params["on_conflict"], ["user_id,device_id"])
        self.assertIn("merge-duplicates", headers["prefer"])

    def test_repeated_registration_never_duplicates_and_keeps_state(self):
        srv = FakePostgrest(); db = PgDB(srv)
        first = register(db)
        srv.rows[0].update(keyboard_active=True, last_snapshot_at="2026-11-01T10:00:00+00:00")
        second = register(db, name="Pixel 8")                         # same device relaunches, name changed
        third = register(db, name="Pixel 8")
        self.assertEqual(len(srv.rows), 1)
        self.assertEqual(first.id, second.id, third.id)
        self.assertEqual(second.display_name, "Pixel 8")
        self.assertTrue(second.keyboard_active)                       # not reset by re-registration
        self.assertEqual(second.last_snapshot_at, "2026-11-01T10:00:00+00:00")

    def test_two_devices_for_one_user_are_two_rows(self):
        srv = FakePostgrest(); db = PgDB(srv)
        register(db, "dev-1"); register(db, "dev-2", "ios", "iPhone")
        self.assertEqual(len(srv.rows), 2)

    def test_http_204_on_write_is_confirmed_by_reading_back(self):
        srv = FakePostgrest(post_mode="empty204")
        out = register(PgDB(srv))                                     # write happened server-side, body empty
        self.assertEqual(out.device_id, "dev-1"); self.assertEqual(len(srv.rows), 1)

    def test_204_without_a_stored_row_is_an_error_not_a_fake_success(self):
        srv = FakePostgrest(post_mode="empty204")
        real = srv.handler
        def drop_write(req):                                          # server says 204 but nothing was stored
            if req.method == "POST": return httpx.Response(204)
            return real(req)
        db = PgDB(srv); db.client.session = httpx.Client(base_url="http://pg.test/rest/v1", transport=httpx.MockTransport(drop_write))
        with self.assertRaises(HTTPException) as cm: register(db)
        self.assertEqual(cm.exception.status_code, 502); self.assertEqual(srv.rows, [])

    def test_database_error_on_write_is_not_swallowed(self):
        def boom(req): return httpx.Response(403, json={"code": "42501", "message": "permission denied", "details": None, "hint": None})
        db = PgDB(FakePostgrest()); db.client.session = httpx.Client(base_url="http://pg.test/rest/v1", transport=httpx.MockTransport(boom))
        with self.assertRaises(APIError): register(db)

    def test_heartbeat_unknown_device_is_404_and_known_device_updates(self):
        from app.api import devices
        from app.schemas.behavioral import DeviceHeartbeatRequest
        srv = FakePostgrest(); db = PgDB(srv)
        orig = devices.get_supabase_admin; devices.get_supabase_admin = lambda: db
        try:
            with self.assertRaises(HTTPException) as cm:
                asyncio.run(devices.heartbeat("nope", DeviceHeartbeatRequest(keyboard_active=True), {"sub": UID}))
            self.assertEqual(cm.exception.status_code, 404)
        finally:
            devices.get_supabase_admin = orig

    def test_no_maybe_single_left_in_the_api_layer(self):
        for f in (ROOT / "app" / "api").glob("*.py"):
            self.assertNotIn(".maybe_single()", f.read_text(), f.name)


# ───────────────────────── Error 2: database timeouts ─────────────────────────
class TestRetryHelper(unittest.TestCase):
    def test_returns_after_transient_failures(self):
        calls, sleeps = [], []
        def fn():
            calls.append(1)
            if len(calls) < 3: raise httpx.ReadTimeout("read timed out")
            return "ok"
        self.assertEqual(run(fn, sleep=sleeps.append), "ok")
        self.assertEqual(len(calls), 3); self.assertEqual(len(sleeps), 2); self.assertLess(sleeps[0], sleeps[1])

    def test_gives_up_with_database_unavailable(self):
        calls, sleeps = [], []
        def fn(): calls.append(1); raise httpx.ReadTimeout("read timed out")
        with self.assertRaises(DatabaseUnavailable) as cm: run(fn, attempts=3, sleep=sleeps.append)
        self.assertEqual(len(calls), 3); self.assertIsInstance(cm.exception.__cause__, httpx.ReadTimeout)

    def test_connect_errors_are_transient_too(self):
        n = []
        def fn():
            n.append(1)
            if len(n) == 1: raise httpx.ConnectError("refused")
            return 1
        self.assertEqual(run(fn, sleep=lambda s: None), 1)

    def test_api_errors_are_not_retried_or_hidden(self):
        calls = []
        def fn(): calls.append(1); raise APIError({"message": "bad", "code": "42P01"})
        with self.assertRaises(APIError): run(fn, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)

    def test_programming_errors_are_not_hidden(self):
        with self.assertRaises(KeyError): run(lambda: {}["x"], sleep=lambda s: None)


class FlakyDB(FakeDB):
    """Fake DB whose queries on given tables raise a timeout for the first N executions."""
    def __init__(self, failures: dict):
        super().__init__(); self.failures = dict(failures); self.log = []
    def table(self, name):
        q = super().table(name); real = q.execute
        def execute():
            self.log.append(name)
            if self.failures.get(name, 0) > 0:
                self.failures[name] -= 1; raise httpx.ReadTimeout("The read operation timed out")
            return real()
        q.execute = execute; return q


class TestForecastTimeouts(unittest.TestCase):
    def setUp(self):
        from app.services import forecast_service as fs
        self.fs = fs
        self.sleep = db_retry.time.sleep; db_retry.time.sleep = lambda s: None       # no real waiting in tests
        fs._PROFILE_CACHE.update(at=0.0, data={})

    def tearDown(self): db_retry.time.sleep = self.sleep

    def _db(self, failures):
        db = FlakyDB(failures); db.tables["users"] = [{"id": UID, "lstm_model_trained_at": None}]; return db

    def _forecast(self, db): return asyncio.run(self.fs.get_forecast_for_user(UID, db))

    def test_transient_timeout_on_user_lookup_is_retried(self):
        db = self._db({"users": 2})                                  # the exact failing query from the report
        res = self._forecast(db)
        self.assertEqual(db.log.count("users"), 3)
        self.assertEqual(res.days_needed, self.fs.DAYS_NEEDED)

    def test_transient_timeout_on_checkin_count_is_retried(self):
        db = self._db({"mood_checkins": 1}); res = self._forecast(db)
        self.assertEqual(db.log.count("mood_checkins"), 2); self.assertEqual(res.checkins_count, 0)

    def test_result_after_retry_equals_result_without_timeout(self):
        a = self._forecast(self._db({})); b = self._forecast(self._db({"users": 2, "mood_checkins": 2}))
        da, db_ = a.model_dump(), b.model_dump(); da.pop("generated_at", None); db_.pop("generated_at", None)
        self.assertEqual(da, db_)

    def test_starter_forecast_fallback_still_works_for_new_users(self):
        res = self._forecast(self._db({}))
        self.assertFalse(res.source == "personal")
        self.assertTrue(res.model_ready and res.source == "global")   # Tier-0 prior keeps the starter forecast available

    def test_persistent_timeout_raises_database_unavailable(self):
        db = self._db({"users": 99})
        with self.assertRaises(DatabaseUnavailable): self._forecast(db)
        self.assertEqual(db.log.count("users"), 3)                   # bounded retries

    def test_persistent_timeout_while_building_starter_forecast_is_reported(self):
        db = self._db({"if_scores": 99})
        with self.assertRaises(DatabaseUnavailable): self._forecast(db)

    def test_unknown_user_still_returns_not_ready(self):
        db = FlakyDB({}); res = self._forecast(db)
        self.assertFalse(res.model_ready)

    def test_endpoint_returns_503_not_a_fabricated_forecast(self):
        from app.api import forecast as api
        orig = api.get_supabase_admin; api.get_supabase_admin = lambda: self._db({"users": 99})
        try:
            with self.assertRaises(HTTPException) as cm: asyncio.run(api.get_3day_forecast({"sub": UID}))
        finally: api.get_supabase_admin = orig
        self.assertEqual(cm.exception.status_code, 503); self.assertIn("Retry-After", cm.exception.headers)

    def test_endpoint_succeeds_after_a_brief_timeout(self):
        from app.api import forecast as api
        orig = api.get_supabase_admin; api.get_supabase_admin = lambda: self._db({"users": 1})
        try: res = asyncio.run(api.get_3day_forecast({"sub": UID}))
        finally: api.get_supabase_admin = orig
        self.assertEqual(res.days_needed, self.fs.DAYS_NEEDED)

    def test_non_timeout_database_errors_still_surface(self):
        db = self._db({})
        real = db.table
        def bad(name):
            q = real(name)
            if name == "users":
                def execute(): raise APIError({"message": "permission denied", "code": "42501"})
                q.execute = execute
            return q
        db.table = bad
        with self.assertRaises(APIError): self._forecast(db)


class TestClientTimeoutConfig(unittest.TestCase):
    def test_supabase_clients_get_a_bounded_postgrest_timeout(self):
        try:
            from app.core import database
        except Exception as e:
            self.skipTest(f"supabase client not importable here: {e}")
        opts = database._options()
        self.assertEqual(opts.postgrest_client_timeout, database.POSTGREST_TIMEOUT_SECONDS)
        self.assertLessEqual(database.POSTGREST_TIMEOUT_SECONDS, 15)


if __name__ == "__main__":
    unittest.main(verbosity=2)
