# Deploy SomGuard (free, public, auto-updating on push)

Deployment architecture — every piece has a free tier:

| Part | Host | Role |
| --- | --- | --- |
| `frontend/` (Next.js) | **Vercel** | Public dashboard for users |
| `agent/` (Node API + jobs) | **Render** | Agent API backend |
| Database | **Supabase** | Stores users, session keys, audit |
| Smart contracts | **Somnia Testnet** | Already deployed (`config/public-chains.json`) — nothing to do |

Both Vercel and Render **auto-deploy**: every `git push` to the `main` branch rebuilds both sides.

> Before you start: push this repo to GitHub (if you haven't). Vercel and Render both connect through GitHub.

---

## 1. Database — Supabase (5 minutes)

1. Create a project at https://supabase.com (Free plan).
2. Open **SQL Editor** → **New query** → paste the **entire** contents of [`infra/supabase/setup.sql`](../infra/supabase/setup.sql) → **Run**. (This is the pre-merged 3-table file; don't use `schema.sql` — it uses `\i`, which only works in psql.)
3. Go to **Project Settings → API** and copy two values:
   - `Project URL` → variable `SUPABASE_URL`
   - `service_role` secret → variable `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Backend — Render (Blueprint, auto-deploy)

The repo already ships [`render.yaml`](../render.yaml), so Render configures itself.

1. https://render.com → **New** → **Blueprint** → pick this GitHub repo → Render reads `render.yaml` and creates the `somguard-agent` service.
2. When prompted, fill in the **secrets** (Environment tab). Use the same values you run locally in `agent/.env`:
   - `THIRDWEB_SECRET_KEY`
   - `THIRDWEB_CLIENT_ID`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from step 1)
   - `SESSION_KEY_ENCRYPTION_KEY` (32-byte key; **reuse the existing key** if you already have session keys in the DB)
   - `AGENT_WALLET_ADDRESS` (if you have one)
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` (if using Telegram)
   - `ALLOWED_ORIGINS` → leave **blank for now**; you'll set the Vercel URL in step 4.
3. **Create** → wait for build (`pnpm … build`) + start (`pnpm … start`). When it's green, copy the service URL, e.g. `https://somguard-agent.onrender.com`.
4. Smoke test: open `https://<render-url>/api/health` → it must return JSON `{ ok: true, ... }`.

> Non-secret vars (port, thresholds, heartbeat…) are already set in `render.yaml`. The port is provided by Render via `$PORT` — the code reads it automatically.

---

## 3. Frontend — Vercel

1. https://vercel.com → **Add New → Project** → import this GitHub repo.
2. **Root Directory** → set to `frontend`. (Vercel auto-detects Next.js + pnpm.)
3. **Environment Variables** — add:
   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_AGENT_API_URL` | the Render URL from step 2 (e.g. `https://somguard-agent.onrender.com`) |
   | `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` | your thirdweb client id |
   | `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | bot username (e.g. `@somguard_bot`) — if using Telegram |
4. **Deploy** → grab the URL, e.g. `https://somguard.vercel.app`.

---

## 4. Connect backend ↔ frontend (CORS)

1. Back in Render → `somguard-agent` service → **Environment** → set:
   ```
   ALLOWED_ORIGINS = https://somguard.vercel.app
   ```
   (Your exact Vercel URL. Any `*.vercel.app` domain — including preview deploys — is allowed automatically, so this step mainly matters for a custom domain.)
2. Save → Render redeploys automatically. Done: open the Vercel URL, connect a wallet, use it for real.

---

## 5. Auto-update on push

Already enabled — no manual CI needed:

- **Push to `main`** → Vercel rebuilds the frontend **and** Render rebuilds the backend.
- Pull Request → Vercel creates a dedicated **preview URL** (CORS already allows `*.vercel.app`).

Want a different branch? Change the tracked branch in both Vercel's and Render's settings.

---

## Important notes

- **Render free sleeps after ~15 minutes of no requests** → the first call is slow (~30–50s) and background jobs (heartbeat/Telegram) pause while asleep. Free keep-alive: create a cron at https://cron-job.org that pings `https://<render-url>/api/health` every 10 minutes.
- **`SESSION_KEY_ENCRYPTION_KEY` must stay constant.** Changing it corrupts every encrypted session key already in the DB.
- Never expose `*_SERVICE_ROLE_KEY`, `THIRDWEB_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, or `SESSION_KEY_ENCRYPTION_KEY` to `NEXT_PUBLIC_*` or the client.
- Contracts are already deployed on Somnia Testnet; no redeploy needed. Users need a wallet with **STT testnet** funds to pay for on-chain transactions.
- **Approval Risk Scanner** (Allowances tab) needs its own deploy + agent IDs before it can score risk: deploy `ApprovalRiskScanner.sol`, set `APPROVAL_SCANNER_CONTRACT_ADDRESS` (or `config/public-chains.json → contracts.approvalRiskScanner`) and the `APPROVAL_SCANNER_*_AGENT_ID`s, then run `pnpm --dir contracts configure:agents`. Approval **discovery** works without it; `scan/prepare` returns `scanner_not_configured` until configured. The public Somnia Blockscout explorer is rate-limited — use an API key / self-hosted instance for heavy scanning.
