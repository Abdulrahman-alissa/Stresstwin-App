"""
StressTwin ML package
======================
Everything under this package runs *inside* the FastAPI backend process
(local CPU inference / lightweight periodic training jobs kicked off by
APScheduler or the offline `scripts/train_global.py` job). No request path
ever triggers a full model training run — see ml/inference.py.

Layout
------
ml/models/            model architectures + (local cache of) trained weights
ml/training/          dataset construction + training entry points
ml/data/tier0/         prepared StudentLife Stress-EMA CSVs (Tier 0)
ml/data/global_baseline/ prepared StudentLife app-usage/calendar CSVs (Tier 1)
                       (never committed with real data)
ml/model_manager.py   versioning + Supabase Storage load/save
ml/inference.py       the only module the API layer talks to at request time
"""
