"""
Evaluation of the EXISTING StressTwin global models (Tier 0 prior, Tier 1 baseline v1 & v2).

Read-only: published model files are only loaded, never written, and nothing is connected to the app.
Run from the backend root:   python validation_results/evaluate_models.py

Every number is computed here from the shipped CSVs and model files. Each metric is tagged with what it is:
  TRAIN (in-sample)  : model already saw these rows (published models are fit on 100 % of the data)
  HELD-OUT           : model was refit WITHOUT the evaluated participants (same code, same hyper-parameters)
"""
import json, sys, warnings
from pathlib import Path
import numpy as np, pandas as pd, joblib
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import stats
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, precision_score, recall_score, f1_score,
                             roc_auc_score, average_precision_score, brier_score_loss, log_loss, confusion_matrix,
                             roc_curve, mean_absolute_error, mean_squared_error, r2_score)
from sklearn.model_selection import GroupShuffleSplit, GroupKFold
from sklearn.calibration import calibration_curve

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from ml.features_global import WINDOW_FEATURE_NAMES, WINDOW_LABEL_COLUMN, STRESS_EMA_RISK_THRESHOLD
from ml.models.global_baseline import GlobalBehavioralBaseline
from ml.training.train_global_baseline import train_global_baseline, load_pooled

SEED = 42
R = {"notes": [], "leakage": {}}
rng = np.random.default_rng(SEED)

# ───────────────────────── data ─────────────────────────
b = pd.read_csv(ROOT / "ml/data/global_baseline/studentlife.csv")
t0 = pd.read_csv(ROOT / "ml/data/tier0/studentlife_stress_ema.csv")
b["pid"] = b["source"].astype(str) + ":" + b["participant"].astype(str)
X = b[WINDOW_FEATURE_NAMES].to_numpy(float); y = b[WINDOW_LABEL_COLUMN].to_numpy(int); g = b["pid"].to_numpy()
R["data"] = {
    "tier1_rows": len(b), "tier1_participants": int(b.pid.nunique()), "tier1_positive_rate": round(float(y.mean()), 4),
    "tier1_date_range": [b.date.min(), b.date.max()],
    "tier1_calendar_missing_rate": round(float(b["calendar_meeting_density"].isna().mean()), 4),
    "tier0_rows": len(t0), "tier0_participants": int(t0.series_id.nunique()), "tier0_date_range": [t0.date.min(), t0.date.max()],
}

# ───────────────────── 1. do stored results exist? ─────────────────────
vals = {}
for v in ("v1", "v2"):
    m = joblib.load(ROOT / f"ml/models/saved/tier1/baseline/{v}/model.joblib")
    vals[v] = m
    R.setdefault("stored_model_attrs", {})[v] = {k: val for k, val in vars(m).items() if k != "pipeline"}
R["stored_metrics_found"] = False
R["notes"].append("Model files hold only trained_at, n_samples_trained_on and source_counts: no validation metrics are stored. "
                  "Metrics were printed by the training CLI / written to the model_versions DB table, which was not supplied.")

# v1 vs v2 identical?
c1, c2 = vals["v1"].pipeline.steps[-1][1], vals["v2"].pipeline.steps[-1][1]
same_weights = bool(np.allclose(c1.coef_, c2.coef_) and np.allclose(c1.intercept_, c2.intercept_) and
                    np.allclose(vals["v1"].pipeline.steps[1][1].mean_, vals["v2"].pipeline.steps[1][1].mean_) and
                    np.allclose(vals["v1"].pipeline.steps[0][1].statistics_, vals["v2"].pipeline.steps[0][1].statistics_, equal_nan=True))
p1 = vals["v1"].pipeline.predict_proba(X)[:, 1]; p2 = vals["v2"].pipeline.predict_proba(X)[:, 1]
R["v1_vs_v2"] = {"identical_coefficients_scaler_imputer": same_weights, "max_abs_prediction_diff": float(np.abs(p1 - p2).max()),
                 "trained_at": {k: vals[k].trained_at for k in vals}, "n_trained_on": {k: vals[k].n_samples_trained_on for k in vals}}
R["coefficients_standardised"] = dict(zip(WINDOW_FEATURE_NAMES, [round(float(c), 4) for c in c2.coef_[0]]))

# ───────────────────── helpers ─────────────────────
def clf_metrics(yt, p, thr=0.5):
    pred = (p >= thr).astype(int)
    out = {"accuracy": accuracy_score(yt, pred), "balanced_accuracy": balanced_accuracy_score(yt, pred),
           "precision": precision_score(yt, pred, zero_division=0), "recall": recall_score(yt, pred, zero_division=0),
           "f1": f1_score(yt, pred, zero_division=0), "brier": brier_score_loss(yt, p), "log_loss": log_loss(yt, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1])}
    if len(set(yt)) > 1:
        out["roc_auc"] = roc_auc_score(yt, p); out["pr_auc"] = average_precision_score(yt, p)
    prev = float(np.mean(yt)); out["brier_skill_vs_prevalence"] = 1 - out["brier"] / (prev * (1 - prev)) if 0 < prev < 1 else None
    tn, fp, fn, tp = confusion_matrix(yt, pred, labels=[0, 1]).ravel()
    out["confusion"] = {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}
    out["n"] = int(len(yt)); out["prevalence"] = prev
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}

def reg_metrics(yt, yp):
    return {"mae": round(float(mean_absolute_error(yt, yp)), 4), "rmse": round(float(np.sqrt(mean_squared_error(yt, yp))), 4),
            "r2": round(float(r2_score(yt, yp)), 4), "n": int(len(yt))}

def fit_t1(Xtr, ytr):
    return GlobalBehavioralBaseline(random_state=SEED).fit(Xtr, ytr)

# ───────────────────── 2. leakage audit ─────────────────────
sp = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
tr, va = next(sp.split(X, y, g))
L = R["leakage"]
L["split_participant_overlap"] = sorted(set(g[tr]) & set(g[va]))
L["split_sizes"] = {"train_rows": len(tr), "val_rows": len(va), "train_participants": len(set(g[tr])), "val_participants": len(set(g[va]))}
L["row_overlap"] = len(set(tr) & set(va))
L["label_or_derived_columns_in_features"] = [c for c in WINDOW_FEATURE_NAMES if c in ("label_stress", "label_risk_continuous", "calendar_observed")]
L["preprocessing_inside_pipeline"] = [n for n, _ in vals["v2"].pipeline.steps]  # imputer+scaler fitted with the classifier, on train only
L["published_models_fit_on_all_rows"] = {"n_trained_on": 1270, "dataset_rows": len(b), "held_out_rows_available": 0}
L["tier0_prior_fit_on_all_rows"] = True
# reproduce project's own CLI metrics to prove the split is the one the training script used
ref = train_global_baseline(load_pooled(str(ROOT / "ml/data/global_baseline"))).metrics
m_val = fit_t1(X[tr], y[tr]); pv = m_val.pipeline.predict_proba(X[va])[:, 1]
mine = clf_metrics(y[va], pv)
L["cli_metrics_reproduced"] = {"cli": {k: ref[k] for k in ("val_accuracy", "val_precision", "val_recall", "val_auc", "n_train", "n_val")},
                               "this_script": {"val_accuracy": mine["accuracy"], "val_precision": mine["precision"], "val_recall": mine["recall"], "val_auc": mine["roc_auc"]},
                               "match": bool(abs(ref["val_accuracy"] - mine["accuracy"]) < 1e-3 and abs(ref["val_auc"] - mine["roc_auc"]) < 1e-3)}
# demonstration of leakage if rows (not participants) were split
from sklearn.model_selection import ShuffleSplit
leaky = []
for a, c in ShuffleSplit(n_splits=20, test_size=0.2, random_state=SEED).split(X):
    mm = fit_t1(X[a], y[a]); leaky.append(roc_auc_score(y[c], mm.pipeline.predict_proba(X[c])[:, 1]))
L["demo_random_row_split_auc_mean(NOT_a_valid_estimate)"] = round(float(np.mean(leaky)), 4)
L["notes"] = [
    "Participant-grouped split: train and validation participants are disjoint (overlap list is empty).",
    "Imputer and scaler sit inside the sklearn Pipeline, so they are fitted on training rows only in the validation model.",
    "Label columns (label_stress, label_risk_continuous) and calendar_observed are not model inputs.",
    "The PUBLISHED v1/v2 models and the Tier 0 prior were fit on every row/participant, so no held-out data exists for them: "
    "any score of the published files on this CSV is TRAINING performance.",
    "Model/feature/threshold choices were iterated in the repo (many *.before_* backups, docstring mentions comparing against GradientBoosting) "
    "using this same seed-42 validation split, so that single split is optimistic as an estimate of new-participant performance. "
    "The repeated grouped CV below is the fairer estimate, but the dataset was still used for design decisions.",
    "Label and features come from the same calendar day (features are not from the future of the label). Days of one participant are strongly correlated, "
    "so splitting by row would leak: see the demo value above.",
]

# ───────────────────── 3. Tier 1 evaluation ─────────────────────
T1 = {}
# (a) published v1 / v2 on all rows = TRAINING performance
for v in ("v1", "v2"):
    p = vals[v].pipeline.predict_proba(X)[:, 1]
    T1[f"{v}_published_TRAIN_insample"] = clf_metrics(y, p)
# (b) validation model from the project's own split (seed 42) = HELD-OUT, single split
T1["validation_model_seed42_HELD_OUT"] = mine
T1["validation_model_seed42_majority_baseline"] = clf_metrics(y[va], np.full(len(va), float(y[tr].mean())))
T1["validation_model_seed42_TRAIN_insample"] = clf_metrics(y[tr], m_val.pipeline.predict_proba(X[tr])[:, 1])
# (c) repeated participant-grouped hold-out (200 splits)
rows = []; base = []
for k, (a, c) in enumerate(GroupShuffleSplit(n_splits=200, test_size=0.2, random_state=1000).split(X, y, g)):
    if len(set(y[c])) < 2: continue
    mm = fit_t1(X[a], y[a]); p = mm.pipeline.predict_proba(X[c])[:, 1]
    r = clf_metrics(y[c], p); rows.append({k2: v2 for k2, v2 in r.items() if isinstance(v2, float)})
    pr = np.full(len(c), y[a].mean()); base.append({"accuracy": accuracy_score(y[c], (pr >= .5).astype(int)), "brier": brier_score_loss(y[c], pr)})
df = pd.DataFrame(rows)
T1["repeated_grouped_holdout_200x_HELD_OUT"] = {c: {"mean": round(float(df[c].mean()), 4), "sd": round(float(df[c].std()), 4)} for c in df.columns}
T1["repeated_grouped_holdout_200x_majority_baseline"] = {"accuracy_mean": round(float(np.mean([x["accuracy"] for x in base])), 4), "brier_mean": round(float(np.mean([x["brier"] for x in base])), 4)}
T1["repeated_grouped_holdout_200x_auc_gt_0.5_share"] = round(float((df.roc_auc > 0.5).mean()), 3)
# (d) out-of-fold predictions, 8-fold GroupKFold (every participant held out once)
oof = np.zeros(len(y)); fold = np.zeros(len(y), int)
for k, (a, c) in enumerate(GroupKFold(n_splits=8).split(X, y, g)):
    oof[c] = fit_t1(X[a], y[a]).pipeline.predict_proba(X[c])[:, 1]; fold[c] = k
T1["oof_8fold_grouped_HELD_OUT"] = clf_metrics(y, oof)
T1["oof_8fold_grouped_HELD_OUT"]["spearman_with_label_risk_continuous"] = round(float(stats.spearmanr(oof, b.label_risk_continuous)[0]), 4)
# participant-bootstrap CI for OOF AUC
pids = np.unique(g); aucs = []
idx_by = {p: np.where(g == p)[0] for p in pids}
for _ in range(1000):
    pick = rng.choice(pids, len(pids)); ii = np.concatenate([idx_by[p] for p in pick])
    if len(set(y[ii])) > 1: aucs.append(roc_auc_score(y[ii], oof[ii]))
T1["oof_8fold_grouped_HELD_OUT"]["roc_auc_95ci_participant_bootstrap"] = [round(float(np.percentile(aucs, 2.5)), 4), round(float(np.percentile(aucs, 97.5)), 4)]
# threshold note: how often does the model ever output >= 0.5 ?
T1["oof_8fold_grouped_HELD_OUT"]["share_of_predictions_ge_0.5"] = round(float((oof >= .5).mean()), 4)
T1["oof_8fold_grouped_HELD_OUT"]["prediction_range"] = [round(float(oof.min()), 3), round(float(oof.max()), 3)]
R["tier1"] = T1

# ───────────────────── 4. Tier 0 evaluation ─────────────────────
t0["dt"] = pd.to_datetime(t0.date); t0["wd"] = t0.dt.dt.weekday; t0["pid"] = t0.series_id.astype(str)
published = {int(k): v for k, v in json.load(open(ROOT / "ml/models/saved/tier0_prior.json")).items()}
recomputed = t0.groupby("wd").label_risk.mean().round(4).to_dict()
R["tier0_prior_reproduced_from_csv"] = {"published": published, "recomputed": recomputed, "match": all(abs(published[k] - recomputed[k]) < 1e-4 for k in range(7)),
                                        "v3_file_equals_current": json.load(open(ROOT / "ml/models/saved/tier0/prior/v3.json")) == {str(k): v for k, v in published.items()}}
yt = t0.label_risk.to_numpy(); pred_pub = t0.wd.map(published).to_numpy(); gm = float(yt.mean())
T0 = {"published_prior_TRAIN_insample_responses": reg_metrics(yt, pred_pub),
      "flat_global_mean_TRAIN_insample_responses": reg_metrics(yt, np.full(len(yt), gm))}
# participant-day level (Tier-1 CSV daily mean risk), weekday from date
b["wd"] = pd.to_datetime(b.date).dt.weekday
T0["published_prior_TRAIN_insample_participant_days"] = reg_metrics(b.label_risk_continuous, b.wd.map(published))
T0["flat_global_mean_TRAIN_insample_participant_days"] = reg_metrics(b.label_risk_continuous, np.full(len(b), b.label_risk_continuous.mean()))
# held-out by participant, repeated
def prior_from(df): m = df.groupby("wd").label_risk.mean(); return {d: float(m.get(d, df.label_risk.mean())) for d in range(7)}
tp = t0.pid.to_numpy(); res = []
for a, c in GroupShuffleSplit(n_splits=500, test_size=0.2, random_state=2000).split(t0, groups=tp):
    tra, tes = t0.iloc[a], t0.iloc[c]; pr = prior_from(tra); p = tes.wd.map(pr).to_numpy(); f = np.full(len(tes), tra.label_risk.mean())
    yy = tes.label_risk.to_numpy()
    res.append({"prior_mae": mean_absolute_error(yy, p), "prior_rmse": np.sqrt(mean_squared_error(yy, p)), "prior_r2": r2_score(yy, p),
                "flat_mae": mean_absolute_error(yy, f), "flat_rmse": np.sqrt(mean_squared_error(yy, f)), "flat_r2": r2_score(yy, f),
                "prior_beats_flat_rmse": float(np.sqrt(mean_squared_error(yy, p)) < np.sqrt(mean_squared_error(yy, f)))})
rd = pd.DataFrame(res)
T0["repeated_grouped_holdout_500x_HELD_OUT_responses"] = {c: {"mean": round(float(rd[c].mean()), 4), "sd": round(float(rd[c].std()), 4)} for c in rd.columns}
# 8-fold grouped OOF
oof0 = np.zeros(len(t0))
for a, c in GroupKFold(n_splits=8).split(t0, groups=tp):
    oof0[c] = t0.iloc[c].wd.map(prior_from(t0.iloc[a])).to_numpy()
flat0 = np.zeros(len(t0))
for a, c in GroupKFold(n_splits=8).split(t0, groups=tp): flat0[c] = t0.iloc[a].label_risk.mean()
T0["oof_8fold_grouped_HELD_OUT_responses"] = {"prior": reg_metrics(yt, oof0), "flat_mean": reg_metrics(yt, flat0)}
# binary view (label_risk >= 0.5) of the prior as a score
yb = (yt >= STRESS_EMA_RISK_THRESHOLD).astype(int)
T0["oof_8fold_grouped_HELD_OUT_binary_view"] = {"threshold": STRESS_EMA_RISK_THRESHOLD, "prevalence": round(float(yb.mean()), 4),
                                                "roc_auc_of_prior_as_score": round(float(roc_auc_score(yb, oof0)), 4),
                                                "accuracy_at_0.5": round(float(accuracy_score(yb, (oof0 >= .5).astype(int))), 4),
                                                "share_predicted_stressed": round(float((oof0 >= .5).mean()), 4)}
# is the weekday effect real? within-participant permutation of weekday labels
def wd_var(df): return float(np.var(list(df.groupby("wd").label_risk.mean().values)))
obs = wd_var(t0); permv = []
for _ in range(2000):
    d2 = t0.copy(); d2["wd"] = d2.groupby("pid").wd.transform(lambda s: rng.permutation(s.values)); permv.append(wd_var(d2))
T0["weekday_effect_permutation_test"] = {"observed_variance_of_weekday_means": round(obs, 6), "perm_p_value": round(float((np.sum(np.array(permv) >= obs) + 1) / 2001), 4),
                                         "weekday_means": {int(k): round(float(v), 4) for k, v in t0.groupby("wd").label_risk.mean().items()},
                                         "weekday_n": {int(k): int(v) for k, v in t0.groupby("wd").size().items()},
                                         "range_of_weekday_means": round(max(published.values()) - min(published.values()), 4)}
R["tier0"] = T0

# ───────────────────── 5. graphs ─────────────────────
plt.rcParams.update({"figure.dpi": 150, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
C1, C2, C3 = "#1F4E9C", "#E07B39", "#6B7280"

# Fig 1  Tier 0 actual vs predicted by weekday (+95 % CI of observed mean)
fig, ax = plt.subplots(1, 2, figsize=(7.6, 3.5))
wm = t0.groupby("wd").label_risk.agg(["mean", "std", "count"]); ci = 1.96 * wm["std"] / np.sqrt(wm["count"])
ax[0].bar(np.arange(7) - .2, [published[d] for d in range(7)], .4, label="Published prior (predicted)", color=C1)
ax[0].errorbar(np.arange(7) + .2, wm["mean"], ci, fmt="o", color=C2, label="Observed mean ± 95 % CI (all data)")
ax[0].axhline(gm, ls="--", color=C3, label="Flat mean"); ax[0].set_xticks(range(7), DAYS); ax[0].set_ylim(0.3, 0.6); ax[0].set_ylabel("Mean stress risk (0–1)")
ax[0].set_title("Weekday prior vs observed\n(TRAINING data)", fontsize=9); ax[0].legend(fontsize=6)
dpm = t0.groupby(["pid", "wd"]).label_risk.mean().reset_index(); dpm["pred_oof"] = dpm.apply(lambda r: prior_from(t0[t0.pid != r.pid])[r.wd], axis=1)
ax[1].scatter(dpm.pred_oof + rng.normal(0, .0015, len(dpm)), dpm.label_risk, s=8, alpha=.4, color=C1)
ax[1].plot([.3, .7], [.3, .7], color=C3, ls="--", label="perfect"); ax[1].set_xlim(.38, .58); ax[1].set_ylim(0, 1)
ax[1].set_xlabel("Predicted (prior fit without this participant)", fontsize=8); ax[1].set_ylabel("Actual participant-weekday mean risk", fontsize=8)
ax[1].set_title("Actual vs predicted\n(leave-one-participant-out, HELD-OUT)", fontsize=9); ax[1].legend(fontsize=6)
fig.tight_layout(); fig.savefig(OUT / "fig1_tier0_actual_vs_predicted.png"); plt.close(fig)
lo = {"mae": mean_absolute_error(dpm.label_risk, dpm.pred_oof), "rmse": float(np.sqrt(mean_squared_error(dpm.label_risk, dpm.pred_oof))), "r2": r2_score(dpm.label_risk, dpm.pred_oof)}
T0["leave_one_participant_out_participant_weekday_means_HELD_OUT"] = {k: round(float(v), 4) for k, v in lo.items()} | {"n": len(dpm)}

# Fig 2  Tier 1: actual vs predicted (held-out OOF) — reliability + P by class
fig, axs = plt.subplots(2, 2, figsize=(7.6, 6.2)); ax = [axs[0, 0], axs[0, 1], axs[1, 0], axs[1, 1]]
fr, mp = calibration_curve(y, oof, n_bins=8, strategy="quantile")
ax[0].plot([0, 1], [0, 1], ls="--", color=C3, label="perfect calibration"); ax[0].plot(mp, fr, "o-", color=C1, label="Tier 1 (held-out OOF)")
ax[0].set_xlabel("Predicted P(stressed)"); ax[0].set_ylabel("Observed share stressed"); ax[0].set_title("(a) Reliability, HELD-OUT", fontsize=9); ax[0].legend(fontsize=7)
ax[1].hist(oof[y == 0], bins=25, alpha=.6, color=C1, label="actual: not stressed", density=True); ax[1].hist(oof[y == 1], bins=25, alpha=.6, color=C2, label="actual: stressed", density=True)
ax[1].axvline(.5, color="k", ls=":"); ax[1].set_xlabel("Predicted P(stressed)"); ax[1].set_title("(b) Predicted P by actual class", fontsize=9); ax[1].legend(fontsize=7)
ax[2].scatter(oof + rng.normal(0, .002, len(oof)), b.label_risk_continuous + rng.normal(0, .015, len(oof)), s=5, alpha=.3, color=C1)
ax[2].set_xlabel("Predicted P(stressed) (held-out)"); ax[2].set_ylabel("Actual daily mean risk (0–1)")
ax[2].set_title(f"(c) Actual vs predicted, HELD-OUT\n(Spearman {T1['oof_8fold_grouped_HELD_OUT']['spearman_with_label_risk_continuous']})", fontsize=9)
fpr, tpr, _ = roc_curve(y, oof); ax[3].plot(fpr, tpr, color=C1, label=f"HELD-OUT, AUC {T1['oof_8fold_grouped_HELD_OUT']['roc_auc']}")
fpr2, tpr2, _ = roc_curve(y, vals["v2"].pipeline.predict_proba(X)[:, 1]); ax[3].plot(fpr2, tpr2, color=C2, ls="--", label=f"v2 on its training data, AUC {T1['v2_published_TRAIN_insample']['roc_auc']}")
ax[3].plot([0, 1], [0, 1], color=C3, ls=":"); ax[3].set_xlabel("False positive rate"); ax[3].set_ylabel("True positive rate"); ax[3].legend(fontsize=6); ax[3].set_title("(d) ROC", fontsize=9)
for a_ in ax: a_.tick_params(labelsize=8); a_.xaxis.label.set_size(8); a_.yaxis.label.set_size(8)
for a_ in ax[:2]: a_.legend(fontsize=6)
fig.tight_layout(); fig.savefig(OUT / "fig2_tier1_actual_vs_predicted.png"); plt.close(fig)

# Fig 3  ROC + confusion matrices
fig, ax = plt.subplots(1, 3, figsize=(12, 3.8))
fpr, tpr, _ = roc_curve(y, oof); ax[0].plot(fpr, tpr, color=C1, label=f"Held-out OOF AUC {T1['oof_8fold_grouped_HELD_OUT']['roc_auc']}")
fpr2, tpr2, _ = roc_curve(y, vals["v2"].pipeline.predict_proba(X)[:, 1]); ax[0].plot(fpr2, tpr2, color=C2, ls="--", label=f"Published v2 on its own training data AUC {T1['v2_published_TRAIN_insample']['roc_auc']}")
ax[0].plot([0, 1], [0, 1], color=C3, ls=":"); ax[0].set_xlabel("False positive rate"); ax[0].set_ylabel("True positive rate"); ax[0].legend(fontsize=7); ax[0].set_title("ROC")
for a_, (nm, cm) in zip(ax[1:], [("HELD-OUT (OOF, thr 0.5)", T1["oof_8fold_grouped_HELD_OUT"]["confusion"]), ("TRAIN in-sample (v2, thr 0.5)", T1["v2_published_TRAIN_insample"]["confusion"])]):
    M = np.array([[cm["tn"], cm["fp"]], [cm["fn"], cm["tp"]]]); a_.imshow(M, cmap="Blues")
    for i in range(2):
        for j in range(2): a_.text(j, i, M[i, j], ha="center", va="center", color="k")
    a_.set_xticks([0, 1], ["pred 0", "pred 1"]); a_.set_yticks([0, 1], ["actual 0", "actual 1"]); a_.set_title(nm, fontsize=8)
fig.tight_layout(); fig.savefig(OUT / "fig3_tier1_roc_confusion.png"); plt.close(fig)

# Fig 4  model comparison
fig, ax = plt.subplots(1, 3, figsize=(7.8, 3.6))
lab = ["Majority", "v1\nTRAIN", "v2\nTRAIN", "Val.\nseed 42", "Grouped\n200×"]
acc = [T1["validation_model_seed42_majority_baseline"]["accuracy"], T1["v1_published_TRAIN_insample"]["accuracy"], T1["v2_published_TRAIN_insample"]["accuracy"],
       T1["validation_model_seed42_HELD_OUT"]["accuracy"], T1["repeated_grouped_holdout_200x_HELD_OUT"]["accuracy"]["mean"]]
auc = [.5, T1["v1_published_TRAIN_insample"]["roc_auc"], T1["v2_published_TRAIN_insample"]["roc_auc"], T1["validation_model_seed42_HELD_OUT"]["roc_auc"], T1["repeated_grouped_holdout_200x_HELD_OUT"]["roc_auc"]["mean"]]
cols = [C3, "#9CB4E0", "#9CB4E0", C1, C1]
ax[0].bar(lab, acc, color=cols); ax[0].set_title("Tier 1 accuracy", fontsize=9); ax[0].set_ylim(0.5, 0.8)
ax[1].bar(lab, auc, color=cols); ax[1].axhline(.5, color="k", ls=":"); ax[1].set_title("Tier 1 ROC AUC (0.5 = chance)", fontsize=9); ax[1].set_ylim(0.4, 0.7)
for a_ in ax[:2]: a_.tick_params(axis="x", labelsize=7)
rm = [T0["oof_8fold_grouped_HELD_OUT_responses"]["flat_mean"]["rmse"], T0["oof_8fold_grouped_HELD_OUT_responses"]["prior"]["rmse"]]
ax[2].bar(["Flat\nmean", "Tier 0\nprior"], rm, color=[C3, C1]); ax[2].set_ylim(0, 0.32); ax[2].set_title("Tier 0 RMSE, HELD-OUT", fontsize=9)
for i, v in enumerate(rm): ax[2].text(i, v, f"{v:.4f}", ha="center", va="bottom", fontsize=8)
fig.tight_layout(rect=(0, .07, 1, 1)); fig.text(0.5, 0.012, "Light bars = TRAINING performance (not validation). Dark bars = HELD-OUT participants. Grey = baseline.", ha="center", fontsize=7, color="#B91C1C") if False else fig.text(0.5, 0.012, "Light bars = TRAINING performance (not validation). Dark bars = HELD-OUT participants. Grey = baseline.", ha="center", fontsize=8, color="#B91C1C"); fig.savefig(OUT / "fig4_model_comparison.png"); plt.close(fig)

# Fig 5  Tier 1 coefficient + dist of repeated-holdout AUC
fig, ax = plt.subplots(1, 2, figsize=(10, 3.6))
ax[0].barh(WINDOW_FEATURE_NAMES, c2.coef_[0], color=[C1 if v > 0 else C2 for v in c2.coef_[0]]); ax[0].set_title("Tier 1 standardised coefficients (v1 = v2)"); ax[0].tick_params(axis="y", labelsize=7)
ax[1].hist(df.roc_auc, bins=30, color=C1); ax[1].axvline(.5, color="k", ls=":"); ax[1].axvline(df.roc_auc.mean(), color=C2); ax[1].set_title("Held-out AUC over 200 participant-grouped splits"); ax[1].set_xlabel("ROC AUC")
fig.tight_layout(); fig.savefig(OUT / "fig5_tier1_coefficients_auc_distribution.png"); plt.close(fig)

# ───────────────────── 6. save ─────────────────────
def clean(o):
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating,)): return float(o)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    return o
json.dump(clean(R), open(OUT / "results.json", "w"), indent=2)
flat = []
def walk(prefix, d):
    for k, v in d.items():
        if isinstance(v, dict) and not all(isinstance(x, (dict, list)) for x in v.values()) and "confusion" not in v and any(isinstance(x, (int, float)) for x in v.values()):
            flat.append({"section": prefix, "evaluation": k, **{kk: vv for kk, vv in v.items() if isinstance(vv, (int, float))}})
        elif isinstance(v, dict): walk(f"{prefix}.{k}", v)
walk("tier1", clean(T1)); walk("tier0", clean(T0)); pd.DataFrame(flat).to_csv(OUT / "metrics_summary.csv", index=False)
print(json.dumps(clean({"tier1": T1, "tier0": T0, "leakage": {k: v for k, v in L.items() if k != "notes"}, "v1_vs_v2": R["v1_vs_v2"], "repro": R["tier0_prior_reproduced_from_csv"]}), indent=1))
