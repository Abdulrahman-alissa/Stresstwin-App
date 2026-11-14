# StressTwin

> **AI-Powered Cross-Platform Stress Detection & Calendar-Aware Prediction**
> Mobile (Android + iOS) · Desktop (Windows + Mac) · Python FastAPI Backend

---

## What StressTwin does

StressTwin passively estimates stress-related behavioral changes using only the devices you already own — no wearable, no camera, no microphone.

| Feature | How it works |
|---|---|
| **Real-time detection** | Isolation Forest scores a 14-feature behavioral vector every 30 seconds against your personal baseline |
| **3-day forecasting** | LSTM neural network combines behavioral history with Google/Outlook calendar data to predict high-stress days in advance |
| **Smart interventions** | Breathing exercise, focus mode, or step-away prompt triggered only after 2 consecutive threshold crossings (hysteresis) |
| **Privacy-first** | Keystroke *timing* only — no content. Calendar titles scanned then immediately discarded. |
| **Zero hardware** | Works on any laptop or smartphone you already own |

---

## Project structure

```
stresstwin/
├── stresstwin-backend/     ← Python FastAPI + ML (Isolation Forest + LSTM)
├── stresstwin-desktop/     ← Electron + React (Windows .exe + macOS .dmg)
└── stresstwin-mobile/      ← React Native + Expo (Android APK + iOS IPA)
```

---

## Quick start (all 3 together)

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.12+ | https://python.org |
| Node.js | 20+ | https://nodejs.org |
| Expo Go (phone) | latest | App Store / Play Store |
| Supabase account | free | https://supabase.com |

---

## Step 1 — Supabase setup

1. Go to https://supabase.com → **New project**
2. Dashboard → **SQL Editor** → **New query**
3. Paste the entire contents of `stresstwin-backend/supabase/migrations/001_initial_schema.sql`
4. Click **Run**
5. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_KEY`
   - **JWT Secret** → `SUPABASE_JWT_SECRET`

---

## Step 2 — Backend

```bash
cd stresstwin-backend

# Create virtual environment
python -m venv .venv

# Activate
# Windows:
.venv\Scripts\activate
# Mac / Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Open .env and fill in all Supabase values + SECRET_KEY
```

**Minimum `.env` to get started:**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
SECRET_KEY=any-random-32-character-string
```

```bash
# Start the backend
uvicorn main:app --reload --port 8000

# API docs available at:
# http://localhost:8000/docs
```

---

## Step 3 — Desktop app (Windows / Mac)

```bash
cd stresstwin-desktop

# Install dependencies
npm install

# Windows only — if uiohook-napi fails:
npm install --global windows-build-tools

# Configure
cp .env.example .env
# Set VITE_API_BASE_URL=http://localhost:8000

# Start in development mode
npm run dev
```

**Build installers:**

```bash
# Windows (.exe installer via NSIS)
npm run build:win
# Output: dist-electron/StressTwin Setup 1.0.0.exe

# macOS (.dmg)
npm run build:mac
# Output: dist-electron/StressTwin-1.0.0.dmg
```

**macOS — Accessibility permission (required for system-wide monitoring):**

On first launch macOS will prompt you. If it doesn't:
1. **System Preferences → Privacy & Security → Accessibility**
2. Add StressTwin to the allowed list

Without this permission the app falls back to in-window monitoring — all other features still work.

---

## Step 4 — Mobile app (Android + iOS)

```bash
cd stresstwin-mobile

# Install dependencies
npm install

# Configure API URL
# Find your computer's local IP:
# Windows: ipconfig → IPv4 Address
# Mac:     ifconfig en0 | grep inet

# Set in app.json → extra.apiBaseUrl:
# "apiBaseUrl": "http://192.168.1.X:8000"

# Start Expo dev server
npm start

# Scan the QR code with Expo Go on your phone
```

**Production build with EAS:**

```bash
# Install EAS CLI
npm install -g eas-cli

# Log in
eas login

# Android APK (internal testing)
npm run build:android

# iOS IPA (requires Apple Developer account)
npm run build:ios

# Submit to stores
npm run submit:android
npm run submit:ios
```

---

## Google Calendar OAuth setup

1. Go to https://console.cloud.google.com
2. Create a new project → **APIs & Services → Enable APIs**
3. Enable **Google Calendar API**
4. **Credentials → Create OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:8000/api/calendar/google/callback`
5. Copy **Client ID** and **Client Secret** into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

---

## Outlook / Microsoft Graph OAuth setup

1. Go to https://portal.azure.com → **Azure Active Directory → App registrations**
2. **New registration**
   - Name: StressTwin
   - Redirect URI: `http://localhost:8000/api/calendar/outlook/callback`
3. **API permissions → Add → Microsoft Graph → Calendars.Read**
4. **Certificates & secrets → New client secret**
5. Copy into `.env`:
   ```env
   MICROSOFT_CLIENT_ID=your-app-client-id
   MICROSOFT_CLIENT_SECRET=your-client-secret
   ```

---

## API reference

All endpoints require `Authorization: Bearer <token>` except `/` and `/health`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account → returns JWT |
| `POST` | `/api/auth/login` | Sign in → returns JWT |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET`  | `/api/users/me` | User profile + model status |
| `PATCH`| `/api/users/me` | Update name / IF threshold |
| `DELETE`| `/api/users/me/data` | GDPR delete all data |
| `POST` | `/api/events/batch` | Submit 30s behavioral window → IF score |
| `GET`  | `/api/scores/current` | Latest score + 60-min trend |
| `GET`  | `/api/scores/history?days=30` | Daily score history |
| `GET`  | `/api/forecast/3day` | LSTM 3-day risk forecast |
| `POST` | `/api/forecast/checkin` | Submit mood rating (1–5) |
| `GET`  | `/api/calendar/google/connect` | Get Google OAuth URL |
| `GET`  | `/api/calendar/google/callback` | OAuth redirect handler |
| `POST` | `/api/calendar/google/sync` | Manually trigger calendar sync |
| `DELETE`| `/api/calendar/google/disconnect` | Remove Google token |
| `GET`  | `/api/calendar/outlook/connect` | Get Outlook OAuth URL |
| `POST` | `/api/calendar/outlook/sync` | Manually trigger Outlook sync |
| `DELETE`| `/api/calendar/outlook/disconnect` | Remove Outlook token |
| `GET`  | `/api/calendar/status` | Check which calendars are connected |

---

## How the AI models work

### Isolation Forest (real-time, every 30s)

- **Algorithm:** Unsupervised anomaly detection — scores how different your current behavior is from your personal baseline
- **Input:** 14-feature vector (keystroke timing, error rate, mouse velocity, gyroscope variance, session length, time-of-day encoding)
- **Output:** Deviation score 0–100 (higher = more anomalous)
- **Training:** Starts automatically after 7 days of data, retrained weekly
- **Cold start:** Returns a normalized baseline score until training completes

### LSTM Neural Network (forecasting, every 6h)

- **Architecture:** 2 stacked LSTM layers (128→64 units) + fully-connected output
- **Input:** 14-day sequence × 11 features (5 behavioral aggregates + 6 calendar features per day)
- **Output:** Risk probability [0,1] for each of the next 3 days
- **Training:** Starts after 28 days of data + 20 mood check-ins
- **Calendar features:** exam flag, meeting density, earliest start, committed hours, consecutive loaded days, days to next free day

---

## Intervention engine

```
Score every 30s
      ↓
Score > threshold?
      ├─ No  → IDLE (monitor silently)
      └─ Yes → ALERT_PENDING
                    ↓
             2nd consecutive crossing?
                    ├─ No  → back to IDLE
                    └─ Yes → TRIGGERED
                                  ↓
                         Select type:
                         breathing | focus | step_away
                                  ↓
                         15-min SUPPRESSED window
                                  ↓
                         back to IDLE

After 3 dismissals: threshold raised +10 for session
```

---

## Deployment (production)

### Backend → Render

1. Push `stresstwin-backend/` to GitHub
2. https://render.com → **New → Web Service**
3. Connect repository, set:
   - **Runtime:** Python 3
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add all `.env` variables in Render dashboard
5. Deploy

> **Free tier** sleeps after 15 min of inactivity. The app sends `/health` pings every 10 min to prevent this. Upgrade to Render Starter ($7/mo) for always-on.

### Mobile → Expo EAS

```bash
# Update app.json → extra.apiBaseUrl to your Render URL
eas build --platform android --profile production
eas build --platform ios     --profile production
eas submit --platform android
eas submit --platform ios
```

### Desktop → GitHub Releases

```bash
npm run build:win   # → dist-electron/StressTwin Setup 1.0.0.exe
npm run build:mac   # → dist-electron/StressTwin-1.0.0.dmg
# Upload both to a GitHub Release
```

---

## Privacy

| What IS captured | What is NEVER captured |
|---|---|
| Keystroke *timing* intervals (ms between keys) | Keystroke *content* (what you type) |
| Mouse *velocity* and trajectory smoothness | Mouse coordinates (where you click) |
| Gyroscope angular variance (statistical) | Screen contents or screenshots |
| Session duration | Audio or microphone |
| Calendar event metadata (times, durations) | Calendar descriptions or attendees |
| | Personal messages or emails |

All behavioral data is encrypted at rest (AES-256). Row Level Security ensures strict per-user database isolation. Users can export or delete all data at any time from Settings.

---

## Tech stack

### Backend
- Python 3.12 + FastAPI 0.111
- Scikit-learn 1.5 — Isolation Forest
- PyTorch 2.3 — LSTM neural network
- PostgreSQL 16 via Supabase
- APScheduler 3.10 — background jobs
- Google Calendar API v3 + Microsoft Graph API

### Desktop
- Electron 31 + React 18 + TypeScript
- Vite 5 — build tool
- uiohook-napi — system-wide keyboard/mouse hooks
- Zustand 4 — state management
- Recharts 2 — charts
- electron-builder — `.exe` / `.dmg` packaging

### Mobile
- React Native 0.74 + Expo SDK 51
- Expo Router 3.5 — file-based navigation
- expo-sensors — gyroscope, accelerometer
- expo-notifications — push notifications
- expo-secure-store — encrypted token storage
- expo-web-browser — OAuth flow
- Zustand 4 — state management
- EAS Build — production APK / IPA

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `uiohook-napi` install fails on Windows | Run `npm install --global windows-build-tools` first |
| macOS: keyboard monitoring not working | System Preferences → Privacy & Security → Accessibility → add StressTwin |
| Backend 401 on all requests | Check `SECRET_KEY` in `.env` matches what was used to generate the token |
| Calendar OAuth redirect fails | Ensure redirect URIs in Google Console / Azure match exactly what's in `.env` |
| Mobile can't reach backend | Use your PC's LAN IP (not `localhost`) in `app.json → extra.apiBaseUrl` |
| LSTM forecast not showing | Requires 28 days of data + 20 mood check-ins |
| Render backend cold-starting slowly | Upgrade to Render Starter ($7/mo) for always-on |

---

## References

1. Koldijk et al. (2014). *SWELL Knowledge Work Dataset.* ACM ICMI.
2. Epp et al. (2011). *Identifying Emotional States Using Keystroke Dynamics.* CHI.
3. Liu et al. (2008). *Isolation Forest.* IEEE ICDM.
4. Hochreiter & Schmidhuber (1997). *Long Short-Term Memory.* Neural Computation.
5. Gjoreski et al. (2017). *Monitoring stress with a wrist device using context.* JBI.

---

*StressTwin — CS Capstone Project 2026 · Dr. Mohammad Farhat *
