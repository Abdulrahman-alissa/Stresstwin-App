# GLOBAL_DATASET_STRATEGY.md — StudentLife-only global training

**Decision: only StudentLife is used for global training.** SWELL-KW and
MobileStress are not used anywhere in this pipeline. This document is the
column-by-column mapping and design rationale for that decision — read
this before touching `ml/features_global.py`, `ml/models/global_baseline.py`,
or `ml/training/prepare_studentlife.py`.

---

## 0. The one rule everything else follows (unchanged)

**A Global-training feature is only usable if StressTwin's own collector
can produce the same thing for a live user.** StressTwin's own collector
produces: keystroke timing, typing error/correction rate, mouse movement,
click behavior, touch pressure, gyroscope/motion, idle time,
application-switch rate, session duration (`ml/features.py::RAW_WINDOW_FEATURE_NAMES`),
plus calendar-derived load features already computed for Personal users
(`calendar_events` table). Nothing else. Every StudentLife column below is
filtered through that list.

---

## 1. What StudentLife sources are actually used

Four files, matching the real StudentLife export format (verified against
actual sample files, not assumed):

1. **`running_app_u*.csv`** — app usage / foreground-task log
2. **`calendar_u*.csv`** — calendar event log
3. **`Stress_u*.json`** — daily "Stress" EMA (**primary label**)
4. **`PerceivedStressScale.csv`** — PSS-10 survey (secondary sanity check only)

No sensing/activity (accelerometer), GPS, conversation/audio, phone-lock,
or sleep-survey files are read by this pipeline at all. Three other
StudentLife EMA surveys were evaluated and are explicitly NOT used (see
§3). The raw StudentLife files themselves are never modified; every
derived feature/label below is computed into a NEW CSV by
`ml/training/prepare_studentlife.py`.

---

## 2. Why the daily Stress EMA replaced PSS-10 as the primary label

PSS-10 is only administered **twice** per participant (pre/post a ~10-week
study). That capped an earlier version of this pipeline at one aggregate
row per participant (~40–50 rows total) and forced Tier 0 into a flat,
non-weekday-varying prior — a real limitation, not a design choice.

The **"Stress" EMA** (`Stress_u*.json`) is answered dozens of times per
participant, spread across many days — verified against a real
participant's file: 74 valid responses across ~2.5 months. That supports:

- **Tier 1**: one training row per (participant, day) instead of one per
  participant — real daily behavioral features paired with that day's real
  mean stress report. ~46 days for a single verified participant; scaled
  across StudentLife's ~48 participants this is easily 1,000+ rows,
  vs. the ~40–50 the PSS-10-only design was stuck at.
- **Tier 0**: a genuine weekday-conditioned prior again (verified: `{Mon:
  0.70, Tue: 0.70, Wed: 0.42, Thu: 0.43, Fri: 0.41, Sat: 0.50, Sun: 0.32}`
  for one participant — real variation, not a flat number).

PSS-10 is kept as a **secondary, printed-only correlation check**
(`ml/training/prepare_studentlife.py::report_pss_correlation` — compares
each participant's mean daily EMA risk against their PSS-10 score) since
it's still a useful sanity signal, but it's never fed into training.

---

## 3. The mapping table (critical requirement, extended)

### 3.1 `running_app_u*.csv` and `calendar_u*.csv` — unchanged from the previous version

See §3.1/3.2 of the prior revision of this document (same columns, same
derivations) — `ml/training/prepare_studentlife.py` still computes
`app_switch_rate`, `active_hours_norm`, `calendar_meeting_density`,
`calendar_earliest_start`, `calendar_consecutive_loaded_days`,
`calendar_days_to_next_free` identically. Nothing changed here; only the
label source and row granularity changed.

### 3.2 `Stress_u*.json` — daily EMA (new primary label)

| StudentLife field | Derived feature | StressTwin feature | Keep / Remove | Reason |
|---|---|---|---|---|
| `level` (string "1"–"5") | daily mean risk, via `STRESS_EMA_CODEBOOK` | **label only** | **Keep → label**, never a feature | See codebook below; some early-format rows carry a `null` key instead of `level` — skipped, never guessed at |
| `location` (lat,long or "Unknown") | — | — | **Remove** | GPS coordinates; StressTwin has no location capability and none is needed for this label |
| `resp_time` | time key | — | Keep (key only) | Needed to bucket responses into days; never itself a feature |

**`STRESS_EMA_CODEBOOK`** — verified against the actual `EMA_definition.json`
schema for the "Stress" survey's `level` question:

```
[1] A little stressed   → 0.4
[2] Definitely stressed → 0.7
[3] Stressed out        → 1.0
[4] Feeling good        → 0.2
[5] Feeling great       → 0.0
```

This is **not** a linear 1→5 stress scale — codes 1–3 are increasing
stress intensity, 4–5 are positive states (5 more positive than 4). Using
the raw integer directly would have been wrong; this was confirmed from
the real question-definition file, not assumed.

### 3.3 `PerceivedStressScale.csv` — secondary correlation check only

Unchanged scoring (items 4/5/7/8 reverse-scored, sum /40) from the
previous revision, but **no longer the training label** — see §2. Used
only by `report_pss_correlation`, printed to console, never written to a
training CSV or fed to either tier.

### 3.4 Other StudentLife EMA surveys — evaluated and excluded

| Survey | What it asks | Keep / Remove | Reason |
|---|---|---|---|
| **"Dartmouth now"** | Reaction (empathic/appreciative/proud/disappointed/angry/saddened/frustrated/apathetic) to unspecified "recent events" | **Remove** | Explicitly scoped to a one-time campus incident, not general stress — would bake a single confound into a "global" model. (Confirmed: the real sample file has exactly 1 response for the whole study period.) |
| **"Mood 1"** | "How do you think you will be **this time tomorrow**?" (happy/stressed/tired) | **Remove** | Asks the participant to *predict* tomorrow's mood. Using a self-prediction as ground truth for a model whose job is predicting near-future mood would be circular. |
| **"Mood 2"** | "How are you **right now**?" (happy/stressed/tired) | **Remove** (not used as label or feature) | Same-day, but a single mutually-exclusive categorical pick, not an intensity scale — not comparable to `STRESS_EMA_CODEBOOK`'s ordering. Could serve as an informal secondary cross-check later, same role as PSS-10, but isn't wired in (diminishing returns once the Stress EMA and PSS-10 already agree or disagree). |
| **"Mood"** (`happy`/`happyornot`/`sad`/`sadornot`) | Unknown — this survey is **not** in the `EMA_definition.json` schema that was supplied | **Remove** | No question text/option definitions available to interpret the numeric codes correctly. Excluded rather than guessed at, per the "don't invent" rule. |

---

## 4. Final recommended Tier 1 feature set (implementation-ready, unchanged schema)

`ml/features_global.py::WINDOW_FEATURE_NAMES` (still 6 features — only the
label source and row granularity changed, not the feature list):

```
app_switch_rate                    active_hours_norm
calendar_meeting_density           calendar_earliest_start
calendar_consecutive_loaded_days   calendar_days_to_next_free
```

Label: `label_stress` ∈ {0, 1}, from the daily Stress EMA (§2–3.2),
binarized at `STRESS_EMA_RISK_THRESHOLD = 0.5` (cleanly separates
"definitely stressed"/"stressed out" from "a little stressed"/"feeling
good"/"feeling great"). **Explicitly excluded, no exceptions**: HR, HRV,
ECG, EDA, camera, microphone, wearable data, any raw identifier, event
titles/descriptions, account labels, GPS/location.

### The structural consequence, updated

Tier 1 is now one row per **(participant, day)** — not one per
participant. `ml/training/train_global_baseline.py`'s grouped
train/val split (by participant, never splitting one person's days across
both) is what actually matters now — with only 1 aggregate row per
participant this split was previously trivial; with dozens of days per
participant it's now a real generalize-to-a-new-person test, and the code
raises a clear error rather than a cryptic one if fewer than 5
participants are present.

---

## 5. What changed vs. the PSS-10-only design

- `ml/training/prepare_studentlife.py` — extended to read `Stress_u*.json`
  (new), restructured to emit one row per (participant, day) for Tier 1
  instead of one per participant, and to emit every individual EMA
  response (not a per-participant mean) for Tier 0 so a genuine weekday
  breakdown is possible again.
- `ml/features_global.py` — added `STRESS_EMA_CODEBOOK` and
  `STRESS_EMA_RISK_THRESHOLD`; `PSS_STRESS_THRESHOLD`/`PSS_MAX_SCORE` kept
  but now only used by the secondary correlation check.
- `ml/training/train_global_prior.py` — no functional change needed; it
  already supported a real weekday breakdown when given dated rows, it
  just never received any (PSS-10 has no dates at all). Docstring updated
  to reflect that this is now the normal case, not a documented fallback.
- `ml/training/train_global_baseline.py` — added a clear pre-check error
  when fewer than 5 distinct participants are present, since the grouped
  split is no longer trivially satisfied by 1-row-per-group data.
- **Unchanged, as before**: Tier 1's 6-feature schema, Tier 2, the
  Personal Isolation Forest, the Personal LSTM, `ml/model_manager.py`'s
  versioning scheme, and the 4-rung `ml/inference.py::forecast()`
  fallback chain.
