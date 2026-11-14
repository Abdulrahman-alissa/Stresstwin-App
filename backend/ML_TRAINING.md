# ML_TRAINING.md — Training & deploying the global tiers

Operational how-to for training and publishing the three global tiers.
**For the dataset analysis and design rationale (why these datasets, why
these features, why three tiers instead of one), see
[`GLOBAL_DATASET_STRATEGY.md`](./GLOBAL_DATASET_STRATEGY.md) — read that
first if you haven't.** This document assumes that design and just walks
through running it.

Nothing here runs during a live API request — every tier is trained
offline and published as a versioned `model_versions` row.

---

## 0. The three tiers, in one table

| | Tier 0 | Tier 1 | Tier 2 |
|---|---|---|---|
| Name | Population weekday prior | Global Behavioral Baseline | Global Sequence LSTM |
| Source data | StudentLife daily Stress EMA | StudentLife app usage + calendar | Pooled anonymized real StressTwin users |
| Level | Statistic (no model) | Participant-day (~1,000+ rows) | 14-day sequence |
| Feature schema | none (just label) | `ml/features_global.py` (6) | `ml/features.py` (11, same as Personal) |
| Runs on a live user's real data? | No — pure lookup | **Yes**, from day 1 | Yes, once 14 days exist |
| Prep script | `ml/training/prepare_studentlife.py` (produces both Tier 0 and Tier 1 output in one run) | same | `ml.training.dataset.export_anonymized_training_frame` (already exists) |
| Train script | `ml/training/train_global_prior.py` | `ml/training/train_global_baseline.py` | `ml/training/train_global_sequence.py` |
| Publish | `scripts/train_global.py --tier 0` | `--tier 1` | `--tier 2` |
| Available at launch? | Yes | Yes | **No** — bootstraps once enough users opt in |

SWELL-KW and MobileStress are not used — only StudentLife, and only its
`running_app_u*.csv`, `calendar_u*.csv`, `Stress_u*.json` (primary label),
and `PerceivedStressScale.csv` (secondary sanity check only) files. See
`GLOBAL_DATASET_STRATEGY.md` for the full column-by-column mapping and why.

---

## 1. Tier 0 & Tier 1 — one prep script, two outputs

```bash
python -m ml.training.prepare_studentlife --raw-dir /path/to/studentlife/dataset \
    --out-tier1 ml/data/global_baseline/studentlife.csv \
    --out-tier0 ml/data/tier0/studentlife_stress_ema.csv

python scripts/train_global.py --tier 0
python scripts/train_global.py --tier 1
```

One run of `prepare_studentlife.py` reads `running_app_u*.csv` +
`calendar_u*.csv` + `Stress_u*.json` and writes both tiers' input at once:
one row per **(participant, day)** for Tier 1 (real daily behavioral
features + that day's mean Stress-EMA risk), and one row per **individual
EMA response** for Tier 0 (more data points for a genuine weekday
breakdown). If `PerceivedStressScale.csv` is present, its PSS-10 scores
(items 4/5/7/8 correctly reverse-scored) are used only for a printed
correlation sanity-check against the EMA-derived labels — never written to
a training CSV, never fed to either model.

Tier 0 is a **genuine weekday-conditioned prior**, not a flat number: the
Stress EMA is answered many times across many days per participant, so
there's real day-of-week signal — verified on real data: `{Mon: 0.70,
Tue: 0.70, Wed: 0.42, Thu: 0.43, Fri: 0.41, Sat: 0.50, Sun: 0.32}` for one
participant. See `ml/training/train_global_prior.py`'s docstring.

⚠️ Verify the exact column names, the Stress-EMA codebook, and the PSS
Likert-text mapping in `prepare_studentlife.py` against your actual
download before trusting the output — all three were built and verified
against real sample files (including a hand-checked PSS score and a
verified non-monotonic Stress-EMA response ordering — see
`GLOBAL_DATASET_STRATEGY.md` §3.2), but your full download should still be
spot-checked.

`scripts/train_global.py --tier 1` uses ROC-AUC as the default
publication gate. The default threshold is `--min-val-auc 0.55`.
Accuracy is reported for diagnostics but is not used as a publication gate
by default because class imbalance can make accuracy misleading.

The published Tier 1 model is trained on all available participant-day rows
after validation. The validation split is grouped by participant so rows from
the same participant do not appear in both training and validation sets.

For quick local iteration without touching Supabase:
```bash
python -m ml.training.train_global_baseline --data-dir ml/data/global_baseline
```

## 3. Tier 2 — Global Sequence LSTM

```bash
python -m ml.training.train_global_sequence   # readiness check + train, local only
python scripts/train_global.py --tier 2        # readiness check + train + publish
```

No prep script needed — this reads directly from Supabase via
`ml.training.dataset.export_anonymized_training_frame(db, min_days=30)`,
which only includes users with `consent_share_data = true`
(`supabase/migrations/002_ml_model_versioning.sql`). Requires at least 15
such users with 30+ days each (`MIN_USERS` / `MIN_DAYS_PER_USER` in
`ml/training/train_global_sequence.py`) — below that, the command exits
with a clear readiness message instead of training on too little data,
and `ml/inference.py::forecast()` simply keeps using Tier 1 / Tier 0 for
every user until this tier exists.

---

## 4. Save & version (all tiers)

Every tier gets a row in `model_versions`
(`supabase/migrations/002_ml_model_versioning.sql`,
`003_global_tiers.sql`) with its validation metrics, training sample
count, and status, uploaded to Supabase Storage
(`ml/model_manager.py::storage_path`):

```
tier0/prior/v{n}.json
tier1/baseline/v{n}/model.joblib
global/lstm/v{n}/model.pt          (Tier 2)
```

Publishing a new version of any tier automatically archives the previous
active version for that tier — there's always exactly one active version
per tier, and previous versions stay in Storage for rollback.

---

## 5. Deploy (how the backend picks each tier up)

The backend never trains anything — `ml/inference.py::forecast()` only
*reads* whichever `model_versions` row is currently active per tier and
downloads the file on first use, caching it locally
(`ML_MODEL_CACHE_DIR`). So "deploying" a tier is just running its publish
command against your production Supabase project — no backend redeploy
needed. The next forecast request (or the 6-hour scheduler refresh) for
any affected user picks up the new version automatically.

---

## 6. Personal models (automatic — unaffected by any of the above)

- **Personal Isolation Forest** — cold-starts after 7 days / 100 windows
  of a user's own behavioral data, retrains weekly
  (`ml/models/isolation_forest.py`). Never touches public data.
- **Personal LSTM** — once a user has 28+ days + 20+ check-ins, trained
  from scratch on that user's own 11-feature sequences
  (`ml/training/train_personal.py`). Promoted only if it validates below
  `LSTM_PERSONAL_MAX_VAL_MSE`. Once Tier 2 exists, warm-starting
  personalization from the active Tier 2 checkpoint instead of from
  scratch is a natural follow-up (same architecture/feature space now) —
  not implemented yet, see `ml/training/train_global_sequence.py`'s
  docstring.

```python
from app.core.database import get_supabase_admin
from ml.training.train_personal import run_personal_training_for_user

db = get_supabase_admin()
run_personal_training_for_user("‹user-uuid›", db)
```

---

## 7. Retraining cadence summary

| Model | Trigger | Interval |
|---|---|---|
| Personal Isolation Forest | scheduled | weekly |
| Personal LSTM | scheduled | every 2 weeks |
| Tier 0 (weekday prior) | manual | rarely — only if you add more Stress-EMA data |
| Tier 1 (behavioral baseline) | manual | whenever you add/expand a public dataset |
| Tier 2 (sequence LSTM) | manual | periodic, once bootstrapped; re-run as the consenting-user pool grows |

Every global tier is a manual, reviewed publish — none are on an automatic
schedule, since publishing a new one is worth a human glance at the
validation metrics first.
