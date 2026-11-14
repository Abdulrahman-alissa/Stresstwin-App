# StressTwin global models: actual validation results

Produced by `evaluate_models.py` (run with scikit-learn 1.5.x, the version pinned in `requirements.txt` and used to pickle the models).
Nothing here modifies the trained models or connects Tier 1 to the app. All numbers are in `results.json` / `metrics_summary.csv`.
Every metric is labelled **TRAIN (in-sample)** or **HELD-OUT (participants not used to fit)**.

## 1. Do stored results exist?
No. The `.joblib` files store only `trained_at`, `n_samples_trained_on` and `source_counts`. The validation metrics were printed by
the training CLI / meant for the `model_versions` DB table, neither of which was supplied. The published models were fit on all
1,270 rows (`train_global_baseline.py` trains a validation model on a split, then refits the production model on everything),
so **the published files have no held-out data**. Scoring them on the CSV is training performance. To get validation numbers the same
procedure (same code, same seed) was re-run in memory; its split reproduces the CLI's own output exactly (accuracy 0.7189, AUC 0.5823).

## 2. Data
| | Tier 1 | Tier 0 |
|---|---|---|
| Unit | participant-day (1,270) | individual stress-EMA response (2,157) |
| Participants | 48 (StudentLife, 2013-03-25 to 2013-08-15) | 48 |
| Label | `label_stress` = daily mean risk >= 0.5 (34.9 % positive) | `label_risk` in {0, .2, .4, .7, 1} |
| Missing | 75.8 % of calendar features missing (median-imputed) | none |
Project split (seed 42, grouped by participant): train 1,053 rows / 38 participants, validation 217 rows / 10 participants.

## 3. Tier 0, weekday prior (Mon..Sun = .5193 .4753 .4365 .4463 .447 .4125 .4603)
Reproduced exactly from the CSV; `prior/v3.json` equals the current prior (v1 and v2 files are identical to each other).
| Evaluation | MAE | RMSE | R² |
|---|---|---|---|
| TRAIN, responses: prior | 0.2097 | 0.2689 | 0.012 |
| TRAIN, responses: flat mean | 0.2120 | 0.2705 | 0.000 |
| HELD-OUT 8-fold by participant: prior | 0.2127 | 0.2725 | -0.015 |
| HELD-OUT 8-fold by participant: flat mean | 0.2140 | 0.2729 | -0.018 |
| HELD-OUT 500 random participant splits: prior | 0.2142 ± 0.020 | 0.2738 ± 0.024 | -0.051 ± 0.078 |
| HELD-OUT 500 random participant splits: flat mean | 0.2156 ± 0.020 | 0.2744 ± 0.024 | -0.055 ± 0.073 |
- The weekday pattern is statistically real (within-participant permutation test p = 0.0005; Mon highest, Sat lowest, range 0.107).
- It is practically tiny: held-out RMSE improves on a flat mean by 0.0004 (0.15 %); it beats the flat mean in 64 % of splits.
- Binary view (risk >= 0.5, held-out): AUC 0.482, accuracy 0.685 (prevalence of stressed 28.4 %). It does not classify stress.

## 4. Tier 1, global behavioral baseline (logistic regression, 6 features)
**v1 and v2 are the same model** (identical coefficients, scaler, imputer, predictions; only the timestamp differs), so they cannot be compared.
Both were fit on all 1,270 rows.
| Evaluation | Acc. | Balanced acc. | Precision | Recall | F1 | ROC AUC | Brier |
|---|---|---|---|---|---|---|---|
| v1 = v2, **TRAIN** (all 1,270 rows) | 0.650 | 0.499 | 0.000 | 0.000 | 0.000 | 0.574 | 0.2233 |
| Validation model, seed 42, **HELD-OUT** (217 rows, 10 participants) | 0.719 | 0.500 | 0.000 | 0.000 | 0.000 | 0.582 | 0.2096 |
| Majority-class baseline, same 217 rows | 0.719 | 0.500 | 0.000 | 0.000 | 0.000 | 0.500 | 0.2088 |
| 200 random grouped splits, **HELD-OUT** mean ± sd | 0.658 ± 0.072 | 0.502 ± 0.010 | 0.185 ± 0.273 | 0.020 ± 0.032 | 0.033 ± 0.050 | 0.546 ± 0.042 | 0.2277 |
| Majority baseline over the same 200 splits | 0.664 | | | | | 0.5 | 0.2266 |
| 8-fold grouped out-of-fold, **HELD-OUT** (1,270 rows) | 0.644 | 0.498 | 0.286 | 0.014 | 0.026 | 0.450 (95 % CI 0.40 to 0.50) | 0.2331 |
- It almost never predicts "stressed" (1.7 % of held-out predictions >= 0.5; probability range 0.02 to 0.58). Recall is about 0.
- Accuracy never beats the majority-class baseline, and held-out Brier is worse than predicting the prevalence (skill -0.03 to -0.05).
- AUC is 0.55 on average over splits (above 0.5 in 87.5 % of them) but 0.45 on pooled out-of-fold predictions; the seed-42 value of 0.58 is one lucky split of 10 participants.
- Spearman correlation with daily mean risk: -0.08 (held-out). **Conclusion: no reliable predictive signal on new participants.**
- MAE, RMSE and R² are not meaningful for Tier 1: it outputs a probability for a binary label. Brier score (= MSE against the 0/1 label) is reported instead.

## 5. Leakage audit
- PASS: train/validation participants disjoint (overlap list empty), no shared rows; label columns and `calendar_observed` are not features; imputer and scaler live inside the Pipeline (fit on train only).
- NOT AVAILABLE: held-out data for the published models and the Tier 0 prior (both fit on 100 % of data).
- CAUTION: the model type, features and calendar handling were iterated using this same seed-42 split (many `*.before_*` backups; the docstring mentions comparing against GradientBoosting), so that split is optimistic. The repeated grouped CV is fairer, but the dataset still informed design choices.
- Demonstration only (invalid estimate): a random row split would give AUC 0.558 vs 0.546 grouped, i.e. within-person correlation exists but does not inflate this weak model much.
- Only 48 participants from a single university and semester: wide uncertainty; results may not transfer to StressTwin's keyboard users.

## 6. What is missing / what to retrain
- Validation metrics were never stored with the models. Retrain with a script that saves the split, metrics and git commit alongside each model version (or in `model_versions`), and keeps a final test set untouched by design choices.
- Tier 1 should not be connected to the app: it has no demonstrated skill. Improving it needs stronger inputs (StressTwin keyboard/typing features are not in StudentLife) or real StressTwin labels; retraining the same 6 features will not fix it.
- The LSTM (Tier 2) is still untrained; no results exist.
- v2 duplicates v1; remove one or document what changed.
- Tier 0 can stay as a mild fallback, but describe it as a very small weekday effect, not a predictive model.

## Files
`results.json`, `metrics_summary.csv`, `run_output.log`, `evaluate_models.py`, figures:
`fig1_tier0_actual_vs_predicted.png`, `fig2_tier1_actual_vs_predicted.png`, `fig3_tier1_roc_confusion.png`, `fig4_model_comparison.png`, `fig5_tier1_coefficients_auc_distribution.png`.
