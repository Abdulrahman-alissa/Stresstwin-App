"""Quick check that the shipped Tier-0 prior loads and yields a starter forecast for a brand-new user.
Run: python scripts/check_prior.py"""
import json, sys, importlib.util
from datetime import date
from pathlib import Path
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gf", root / "app/services/global_forecast.py")
gf = importlib.util.module_from_spec(spec); spec.loader.exec_module(gf)
prior = gf.prior_profile(json.loads((root / "ml/models/saved/tier0_prior.json").read_text()))
days, cohort = gf.build_days(date.today(), [], gf.merge_prior({}, prior), {})
assert len(prior) == 7 and len(days) == 3 and all(0 <= d["risk"] <= 1 for d in days) and cohort == 0
print("OK", days)
