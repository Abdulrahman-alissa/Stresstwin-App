"""
Tests for automatic personal-LSTM training (app/services/lstm_training.py).
Run from the backend root:   python -m unittest tests.test_lstm_autotrain -v      (or: pytest tests)
Most tests use a fake model backend and an in-memory database, so they need neither torch nor Supabase.
Tests marked "torch" run only when PyTorch is installed.
"""
import os, sys, tempfile, unittest, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "scripts"))
for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_JWT_SECRET", "SECRET_KEY"):
    os.environ.setdefault(k, "test")

from tests.fakedb import FakeDB
from app.services import lstm_training as lt
import seed_test_account as seed                                  # synthetic generator, used ONLY to fill the fake DB

try:
    import torch  # noqa: F401
    HAS_TORCH = True
except Exception:
    HAS_TORCH = False

NOW = datetime.now(timezone.utc)


def user_row(uid, **kw):
    base = {"id": uid, "lstm_model_trained_at": None, "lstm_training_status": "idle", "lstm_training_started_at": None,
            "lstm_last_attempt_at": None, "lstm_last_error": None, "lstm_trained_days": None}
    base.update(kw); return base


def make_db(uid="u1", days=30, checkins=20, seed_=7, extra_users=()):
    db = FakeDB()
    data = seed.generate(uid, days=days, checkins=checkins, seed=seed_)
    db.tables["users"] = [user_row(uid)] + [user_row(u) for u in extra_users]
    db.tables["behavioral_logs"] = data["logs"]
    db.tables["if_scores"] = data["scores"]
    db.tables["mood_checkins"] = data["checkins"]
    db.tables["calendar_events"] = data["calendar"]
    return db, data


class FakeBackend:
    """Stands in for torch: records what it was trained on and writes a small 'weights' file."""
    def __init__(self, loss=0.5, fail=False, pred_fn=None, empty_file=False):
        self.loss, self.fail, self.pred_fn, self.empty_file = loss, fail, pred_fn, empty_file
        self.X = self.y = None; self.fits = 0
    def fit(self, X, y):
        self.fits += 1
        if self.fail: raise RuntimeError("boom")
        self.X, self.y = X, y; return "model", self.loss
    def predict(self, model, X):
        return self.pred_fn(X) if self.pred_fn else np.full((len(X), 3), 0.4)
    def save(self, model, path):
        Path(path).write_bytes(b"" if self.empty_file else b"NEW-WEIGHTS")


class SyncExecutor:
    def submit(self, fn, *a, **k):
        from concurrent.futures import Future
        f = Future()
        try: f.set_result(fn(*a, **k))
        except Exception as e: f.set_exception(e)
        return f


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.dir = Path(self.tmp.name)
        lt._inflight.clear()
    def tearDown(self):
        self.tmp.cleanup(); lt._inflight.clear()


# ───────────────────────── eligibility ─────────────────────────
class TestEligibility(Base):
    def test_eligible_with_30_days_and_20_checkins(self):
        db, _ = make_db()
        e, data = lt.check_eligibility(db, "u1")
        self.assertTrue(e.eligible, e)
        self.assertEqual((e.days, e.checkins), (30, 20))
        self.assertGreaterEqual(e.sequences, lt.MIN_SEQUENCES)
        X, y = data
        self.assertEqual(X.shape[1:], (14, 11)); self.assertEqual(y.shape[1], 3)
        self.assertTrue(np.isfinite(X).all() and ((y >= 0) & (y <= 1)).all())

    def test_too_few_days(self):
        db, _ = make_db(days=20)
        e, _ = lt.check_eligibility(db, "u1")
        self.assertEqual((e.eligible, e.reason), (False, "insufficient_days"))

    def test_too_few_checkins(self):
        db, _ = make_db(checkins=19)
        e, _ = lt.check_eligibility(db, "u1")
        self.assertEqual((e.eligible, e.reason), (False, "insufficient_checkins"))

    def test_not_enough_valid_sequences(self):
        db, _ = make_db()
        # data exists on 30 days, but scores on only every 3rd day -> fewer than 10 active days in any window
        keep = {}
        for s in db.tables["if_scores"]:
            day = s["created_at"][:10]
            keep.setdefault(day, []).append(s)
        days = sorted(keep)
        allowed = {d for i, d in enumerate(days) if i % 3 == 0}
        db.tables["if_scores"] = [s for s in db.tables["if_scores"] if s["created_at"][:10] in allowed]
        e, data = lt.check_eligibility(db, "u1")
        self.assertEqual((e.eligible, e.reason), (False, "insufficient_sequences"))
        self.assertIsNone(data)

    def test_features_match_inference_builder(self):
        """Training features must equal forecast_service._build_sequence (what the model sees at inference)."""
        try:
            from app.services import forecast_service as fs
        except Exception as e:
            self.skipTest(f"forecast_service not importable here: {e}")
        from datetime import date
        today = date.today()                      # forecast_service uses the server's local date
        db, data = make_db()
        fresh = seed.generate("u1", days=30, checkins=20, seed=7, today=today)
        for t, k in (("behavioral_logs", "logs"), ("if_scores", "scores"), ("mood_checkins", "checkins"), ("calendar_events", "calendar")):
            db.tables[t] = fresh[k]
        seq = fs._build_sequence("u1", db)
        h = lt.load_history(db, "u1", today)
        mine = np.array([lt.daily_features(today - timedelta(days=i), h) for i in range(13, -1, -1)], dtype=np.float32)
        self.assertEqual(seq.shape, mine.shape)
        self.assertLess(float(np.abs(seq - mine).max()), 1e-5)


# ───────────────────────── decision / retraining policy ─────────────────────────
class TestDecision(Base):
    def d(self, days=30, checkins=20, model=False, **user):
        return lt.decide(user_row("u1", **user), days, checkins, model, NOW)

    def test_initial_when_eligible_and_no_model(self):
        self.assertEqual((self.d().train, self.d().reason), (True, "initial"))

    def test_not_eligible(self):
        self.assertEqual(self.d(days=27).reason, "insufficient_days")
        self.assertEqual(self.d(checkins=19).reason, "insufficient_checkins")

    def test_missing_model_file_triggers_initial_even_if_trained_at_set(self):
        r = self.d(model=False, lstm_model_trained_at=(NOW - timedelta(days=3)).isoformat(), lstm_trained_days=28)
        self.assertEqual((r.train, r.reason), (True, "initial"))

    def test_up_to_date_until_enough_new_days(self):
        t = (NOW - timedelta(days=3)).isoformat()
        r = self.d(days=30, model=True, lstm_model_trained_at=t, lstm_trained_days=28)
        self.assertEqual((r.train, r.reason), (False, "up_to_date"))

    def test_retrain_after_new_days_and_interval(self):
        t = (NOW - timedelta(days=3)).isoformat()
        r = self.d(days=36, model=True, lstm_model_trained_at=t, lstm_trained_days=28)
        self.assertEqual((r.train, r.reason), (True, "retrain"))

    def test_no_retrain_inside_minimum_interval(self):
        t = (NOW - timedelta(hours=2)).isoformat()
        r = self.d(days=50, model=True, lstm_model_trained_at=t, lstm_trained_days=28)
        self.assertFalse(r.train)

    def test_failure_backoff(self):
        r = self.d(lstm_training_status="failed", lstm_last_attempt_at=(NOW - timedelta(hours=1)).isoformat())
        self.assertEqual((r.train, r.reason), (False, "failure_backoff"))
        r = self.d(lstm_training_status="failed", lstm_last_attempt_at=(NOW - timedelta(hours=7)).isoformat())
        self.assertTrue(r.train)

    def test_running_job_blocks_but_stale_lock_does_not(self):
        r = self.d(lstm_training_status="running", lstm_training_started_at=(NOW - timedelta(minutes=5)).isoformat())
        self.assertEqual((r.train, r.reason), (False, "already_running"))
        r = self.d(lstm_training_status="running", lstm_training_started_at=(NOW - timedelta(hours=3)).isoformat())
        self.assertTrue(r.train)


# ───────────────────────── training, model saving, metadata ─────────────────────────
class TestTrainingJob(Base):
    def test_trains_on_the_users_real_rows_and_saves_model(self):
        db, data = make_db("u1", extra_users=("u2",))
        # a second user with extreme data must not leak into u1's training set
        other = seed.generate("u2", days=30, checkins=20, seed=99)
        for r in other["scores"]: r["deviation_score"] = 100.0
        db.tables["if_scores"] += other["scores"]; db.tables["behavioral_logs"] += other["logs"]
        be = FakeBackend()
        res = lt.run_training_job("u1", db, be, self.dir, NOW)
        self.assertTrue(res.ok, res)
        self.assertGreaterEqual(be.X.shape[0], lt.MIN_SEQUENCES)
        self.assertLess(float(be.y.max()), 0.95)                      # u2's 100.0 scores would give targets near 1.0
        self.assertEqual((self.dir / "u1.pt").read_bytes(), b"NEW-WEIGHTS")
        self.assertFalse((self.dir / "u1.pt.tmp").exists())
        u = db.tables["users"][0]
        self.assertEqual(u["lstm_training_status"], "idle")
        self.assertEqual((u["lstm_trained_days"], u["lstm_trained_sequences"]), (30, len(be.X)))
        self.assertIsNotNone(u["lstm_model_trained_at"]); self.assertIsNone(u["lstm_last_error"])
        self.assertIsNotNone(u["lstm_train_mse"]); self.assertIsNotNone(u["lstm_baseline_mse"])

    def test_targets_blend_checkins_with_scores(self):
        db, _ = make_db()
        h = lt.load_history(db, "u1", NOW.date())
        d = next(day for day in sorted(h.ratings) if day in h.scores and day < NOW.date().isoformat())
        from datetime import date
        day = date.fromisoformat(d)
        base = float(np.mean(h.scores[d])) / 100
        expect = 0.5 * base + 0.5 * (5 - float(np.mean(h.ratings[d]))) / 4
        self.assertAlmostEqual(lt._target(day, h), min(max(expect, 0), 1), places=6)

    def test_not_eligible_does_not_train(self):
        db, _ = make_db(days=20)
        be = FakeBackend()
        res = lt.run_training_job("u1", db, be, self.dir, NOW)
        self.assertFalse(res.ok); self.assertEqual(res.reason, "insufficient_days"); self.assertEqual(be.fits, 0)
        self.assertFalse((self.dir / "u1.pt").exists())
        self.assertEqual(db.tables["users"][0]["lstm_training_status"], "idle")

    def test_retrain_replaces_model_and_keeps_previous_copy(self):
        db, _ = make_db()
        (self.dir / "u1.pt").write_bytes(b"OLD-WEIGHTS")
        res = lt.run_training_job("u1", db, FakeBackend(), self.dir, NOW)
        self.assertTrue(res.ok)
        self.assertEqual((self.dir / "u1.pt").read_bytes(), b"NEW-WEIGHTS")
        self.assertEqual((self.dir / "u1.pt.prev").read_bytes(), b"OLD-WEIGHTS")


# ───────────────────────── failure handling / fallback safety ─────────────────────────
class TestFailures(Base):
    def _fail(self, backend):
        db, _ = make_db()
        (self.dir / "u1.pt").write_bytes(b"OLD-WEIGHTS")
        res = lt.run_training_job("u1", db, backend, self.dir, NOW)
        self.assertFalse(res.ok)
        self.assertEqual((self.dir / "u1.pt").read_bytes(), b"OLD-WEIGHTS", "existing model must survive a failed run")
        self.assertFalse((self.dir / "u1.pt.tmp").exists())
        u = db.tables["users"][0]
        self.assertEqual(u["lstm_training_status"], "failed"); self.assertTrue(u["lstm_last_error"])
        self.assertNotIn("u1", lt._inflight, "lock must be released after a failure")
        return db

    def test_trainer_exception(self): self._fail(FakeBackend(fail=True))
    def test_nan_loss(self): self._fail(FakeBackend(loss=float("nan")))
    def test_out_of_range_predictions(self): self._fail(FakeBackend(pred_fn=lambda X: np.full((len(X), 3), 1.7)))
    def test_nan_predictions(self): self._fail(FakeBackend(pred_fn=lambda X: np.full((len(X), 3), np.nan)))
    def test_wrong_prediction_shape(self): self._fail(FakeBackend(pred_fn=lambda X: np.zeros((len(X), 2))))
    def test_empty_model_file(self): self._fail(FakeBackend(empty_file=True))

    def test_failed_user_is_retried_only_after_backoff(self):
        db = self._fail(FakeBackend(fail=True))
        d = lt.evaluate_user(db, "u1", now=NOW + timedelta(hours=1), model_dir=self.dir)
        self.assertEqual(d.reason, "failure_backoff")
        d = lt.evaluate_user(db, "u1", now=NOW + timedelta(hours=7), model_dir=self.dir)
        self.assertTrue(d.train)

    def test_database_metadata_failure_does_not_crash_job(self):
        db, _ = make_db()
        real = db.table
        def flaky(name):
            q = real(name)
            if name == "users" and getattr(flaky, "armed", False):
                orig = q.execute
                def boom(): raise RuntimeError("db down")
                if q.op == "update": q.execute = boom
            return q
        db.table = flaky
        flaky.armed = False
        # claim happens first (works), metadata updates afterwards fail -> still no exception escapes
        self.assertTrue(lt.claim(db, "u1", NOW)); flaky.armed = True
        res = lt.run_training_job("u1", db, FakeBackend(), self.dir, NOW, already_claimed=True)
        self.assertIsInstance(res, lt.JobResult)


# ───────────────────────── duplicate prevention ─────────────────────────
class TestDuplicates(Base):
    def test_second_claim_is_refused_until_release(self):
        db, _ = make_db()
        self.assertTrue(lt.claim(db, "u1", NOW))
        self.assertFalse(lt.claim(db, "u1", NOW))
        self.assertEqual(db.tables["users"][0]["lstm_training_status"], "running")
        lt.release("u1")
        self.assertFalse(lt.claim(db, "u1", NOW), "database lock still says running")

    def test_database_lock_blocks_another_process(self):
        db, _ = make_db()
        db.tables["users"][0].update(lstm_training_status="running", lstm_training_started_at=NOW.isoformat())
        self.assertFalse(lt.claim(db, "u1", NOW))

    def test_stale_lock_is_released(self):
        db, _ = make_db()
        db.tables["users"][0].update(lstm_training_status="running",
                                     lstm_training_started_at=(NOW - timedelta(hours=3)).isoformat())
        self.assertTrue(lt.claim(db, "u1", NOW))

    def test_enqueue_twice_runs_once(self):
        db, _ = make_db()
        held = []
        class Hold:                                   # accepts work but does not run it (job still "queued")
            def submit(self, fn, *a, **k): held.append((fn, a)); return object()
        self.assertIsNotNone(lt.enqueue_training("u1", db, FakeBackend(), self.dir, Hold()))
        self.assertIsNone(lt.enqueue_training("u1", db, FakeBackend(), self.dir, Hold()))
        self.assertEqual(len(held), 1)

    def test_job_runs_and_releases_slot(self):
        db, _ = make_db()
        fut = lt.enqueue_training("u1", db, FakeBackend(), self.dir, SyncExecutor())
        self.assertTrue(fut.result().ok)
        self.assertNotIn("u1", lt._inflight)
        self.assertEqual(db.tables["users"][0]["lstm_training_status"], "idle")


# ───────────────────────── scheduler ─────────────────────────
class TestScheduler(Base):
    def test_only_users_that_need_training_are_queued(self):
        db, _ = make_db("u1", extra_users=("u2", "u3"))
        # u2: not enough data; u3: eligible data but a job is already running
        data3 = seed.generate("u3", days=30, checkins=20, seed=5)
        db.tables["behavioral_logs"] += data3["logs"]; db.tables["if_scores"] += data3["scores"]
        db.tables["mood_checkins"] += data3["checkins"]; db.tables["calendar_events"] += data3["calendar"]
        db.tables["users"][2].update(lstm_training_status="running", lstm_training_started_at=NOW.isoformat())
        out = lt.schedule_personal_lstm_training(db, FakeBackend(), self.dir, SyncExecutor())
        self.assertEqual(out["queued"], 1)
        self.assertTrue((self.dir / "u1.pt").exists())
        self.assertFalse((self.dir / "u2.pt").exists()); self.assertFalse((self.dir / "u3.pt").exists())

    def test_second_scheduler_run_does_not_retrain_up_to_date_user(self):
        db, _ = make_db()
        be = FakeBackend()
        lt.schedule_personal_lstm_training(db, be, self.dir, SyncExecutor())
        lt.schedule_personal_lstm_training(db, be, self.dir, SyncExecutor())
        self.assertEqual(be.fits, 1)

    def test_one_bad_user_does_not_stop_the_run(self):
        db, _ = make_db("u1", extra_users=("bad",))
        be = FakeBackend()
        orig = lt.evaluate_user
        def evaluate(db_, uid, **k):
            if uid == "bad": raise RuntimeError("corrupt row")
            return orig(db_, uid, **k)
        lt.evaluate_user = evaluate
        try:
            out = lt.schedule_personal_lstm_training(db, be, self.dir, SyncExecutor())
        finally:
            lt.evaluate_user = orig
        self.assertEqual(out["queued"], 1)

    def test_request_training_check_never_raises(self):
        lt.request_training_check("nobody")           # no database configured in the test env -> swallowed


# ───────────────────────── forecast fallback, isolation forest, wiring ─────────────────────────
class TestForecastIntegration(Base):
    def setUp(self):
        super().setUp()
        try:
            from app.services import forecast_service as fs
        except Exception as e:
            self.skipTest(f"forecast_service not importable here: {e}")
        self.fs = fs

    def _run(self, db):
        import asyncio
        return asyncio.run(self.fs.get_forecast_for_user("u1", db))

    def test_corrupt_personal_model_falls_back_to_global(self):
        db, _ = make_db()
        mdir = self.fs.MODEL_DIR; mdir.mkdir(parents=True, exist_ok=True)
        path = mdir / "u1.pt"; path.write_bytes(b"not a model")
        called = {}
        orig = self.fs._global_forecast
        self.fs._global_forecast = lambda *a, **k: called.setdefault("global", True) or "GLOBAL"
        try:
            self._run(db)
        finally:
            self.fs._global_forecast = orig; path.unlink(missing_ok=True)
        self.assertTrue(called.get("global"))

    def test_no_model_file_uses_global_even_if_eligible(self):
        db, _ = make_db()
        called = {}
        orig = self.fs._global_forecast
        self.fs._global_forecast = lambda *a, **k: called.setdefault("global", True) or "GLOBAL"
        try:
            self._run(db)
        finally:
            self.fs._global_forecast = orig
        self.assertTrue(called.get("global"))

    @unittest.skipUnless(HAS_TORCH, "torch not installed")
    def test_torch_end_to_end_trained_model_is_used_by_forecast(self):                      # torch
        db, _ = make_db()
        mdir = self.fs.MODEL_DIR; mdir.mkdir(parents=True, exist_ok=True)
        path = mdir / "u1.pt"; path.unlink(missing_ok=True)
        try:
            res = lt.run_training_job("u1", db, lt.TorchBackend(), mdir, NOW)
            self.assertTrue(res.ok, res)
            self.assertTrue(path.exists())
            fc = self._run(db)
            self.assertEqual(fc.source, "personal")
            self.assertEqual(len(fc.forecasts), 3)
            self.assertTrue(all(0 <= f.risk <= 1 for f in fc.forecasts))
        finally:
            for ext in (".pt", ".pt.prev", ".pt.tmp"): (mdir / f"u1{ext}").unlink(missing_ok=True)

    @unittest.skipUnless(HAS_TORCH, "torch not installed")
    def test_torch_save_is_loadable_state_dict(self):                                          # torch
        import torch
        from app.ml.lstm_model import StressLSTM, fit_model
        X = np.random.default_rng(0).random((12, 14, 11)).astype(np.float32)
        y = np.random.default_rng(1).random((12, 3)).astype(np.float32)
        model, loss = fit_model(X, y, epochs=2, seed=1)
        self.assertTrue(np.isfinite(loss))
        p = self.dir / "m.pt"; lt.TorchBackend().save(model, p)
        m2 = StressLSTM(); m2.load_state_dict(torch.load(str(p), map_location="cpu")); m2.eval()
        self.assertEqual(tuple(lt.TorchBackend().predict(m2, X).shape), (12, 3))


class TestPreservedFunctionalityAndWiring(Base):
    def test_isolation_forest_untouched_by_training(self):
        from app.ml import isolation_forest as iforest
        before = sorted(p.name for p in Path(iforest.MODEL_DIR).glob("*"))
        db, _ = make_db()
        lt.run_training_job("u1", db, FakeBackend(), self.dir, NOW)
        self.assertEqual(before, sorted(p.name for p in Path(iforest.MODEL_DIR).glob("*")))
        self.assertTrue(callable(iforest.train_user_isolation_forest))

    def test_scheduler_keeps_existing_jobs_and_adds_autotrain(self):
        src = (ROOT / "main.py").read_text()
        for job in ('id="cal_sync"', 'id="lstm_refresh"', 'id="if_retrain"', 'id="lstm_autotrain"'):
            self.assertIn(job, src)
        self.assertIn("max_instances=1", src)

    def test_checkin_endpoint_schedules_background_check(self):
        src = (ROOT / "app/api/forecast.py").read_text()
        self.assertIn("background.add_task(request_training_check", src)

    def test_seed_script_trainer_still_available(self):
        if not HAS_TORCH: self.skipTest("torch not installed")
        from app.ml import lstm_model
        self.assertTrue(callable(lstm_model.train_user_lstm) and callable(lstm_model.fit_model))


if __name__ == "__main__":
    unittest.main(verbosity=2)
