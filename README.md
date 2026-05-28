# DevPilot AI

Autonomous self-healing DevOps engineer for incident response, remediation, and deployment hygiene.

## Problem Statement

Production teams still spend too much time turning logs, alerts, drift, and security findings into safe fixes. DevPilot AI compresses that loop into one browser workflow: analyze the signal, generate the remediation, review the plan, and apply recovery with an audit trail.

## Architecture

```mermaid
flowchart LR
  Browser["Browser UI"] --> Frontend["Next.js frontend"]
  Frontend -->|HTTP fetch| Backend["FastAPI backend"]
  Backend --> Neon["Neon PostgreSQL"]
  Backend --> OpenAI["OpenAI API"]
  Backend --> GitHub["GitHub API"]
  Backend --> Slack["Slack webhook"]
  Frontend --> Vercel["Vercel deployment"]
  Frontend --> Netlify["Netlify deployment"]
  Backend --> Render["Render deployment"]
```

## Screenshots

![Hero preview](frontend/public/devpilot-hero.png)
![Home screen](docs/screenshots/home.png)
![Dashboard](docs/screenshots/dashboard.png)
![Demo mode](docs/screenshots/demo.png)

## Setup

### Prerequisites

- Node.js 22+
- Python 3.12+
- Neon PostgreSQL for production

### Environment

Backend `.env`:

```text
APP_ENV=development
DATABASE_URL=
SESSION_SECRET=dev-only-change-me-please-generate-a-real-secret
OPENAI_API_KEY=
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
DEVPILOT_MAX_REQUEST_BODY_BYTES=1500000
DEVPILOT_RATE_LIMIT_WINDOW_SECONDS=60
DEVPILOT_RATE_LIMIT_REQUESTS_PER_WINDOW=120
GITHUB_TOKEN=
GITHUB_REPOSITORY=owner/repo
```

Frontend `.env.local`:

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false
```

### Run Locally

Backend:

```bash
cd backend
copy .env.example .env
python -m pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
copy .env.example .env.local
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

The first visit to an app route prompts you to create the initial owner account.
Production sessions use an HttpOnly signed JWT cookie plus a CSRF token; team
and role access are read from the backend session instead of browser storage.

### Production Checks

```bash
cd backend
python -m pip install -r requirements-dev.txt
python -m py_compile main.py
python -m pytest

cd ../frontend
npm run lint
npm run build
npm run test:e2e
```

Docker:

```bash
docker build -t devpilot-backend ./backend
docker build --build-arg NEXT_PUBLIC_API_URL=https://your-backend.example -t devpilot-frontend ./frontend
```

Full stack with persistent PostgreSQL and Nginx:

```bash
copy .env.example .env
# Replace POSTGRES_PASSWORD and SESSION_SECRET with generated secrets.
docker compose up --build
```

Nginx expects TLS files at `nginx/certs/fullchain.pem` and
`nginx/certs/privkey.pem`. The HTTP listener serves ACME challenge files from
`nginx/certbot/` and redirects app traffic to HTTPS.

## Demo Flow

1. Open the landing page.
2. Click `Run Demo`.
3. Review seeded Kubernetes failures, CI failures, and incident memory.
4. Open the dashboard to inspect remediation, usage, and recovery panels.
5. Ask the voice assistant: `Why did deployment fail?`

## Deployment

Primary production targets: Vercel or Netlify frontend, Render FastAPI backend,
and Neon Postgres. Keep real GitHub, Slack, Kubernetes, and OpenAI credentials
out of local test runs unless you deliberately want live integrations.

### Vercel

- Set the Vercel project root to `frontend/`.
- Use Node.js 22; `frontend/package.json` declares `>=22 <23`.
- Set `NEXT_PUBLIC_API_URL` to the Render HTTPS backend URL.
- Set `NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false` unless live Kubernetes reads are intentionally enabled.
- The frontend uses `frontend/vercel.json` and `frontend/next.config.ts` for production output and headers.
- Store Vercel values in Project Settings, not in committed files.

### Netlify

- Use the repo root with `netlify.toml`; it builds `frontend/` with the same `npm run build` flow.
- Set `NEXT_PUBLIC_API_URL` to the Render HTTPS backend URL.
- Keep `NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false` unless live Kubernetes reads are intentionally enabled.
- `NPM_FLAGS=--legacy-peer-deps` is included for Netlify builds because the frontend uses the same dependency resolution as Vercel.

### Render + Neon

- Deploy the backend service from `render.yaml`.
- Set `APP_ENV=production`.
- Create a Neon Postgres database separately and set its connection string as the required Render secret `DATABASE_URL`.
- Set `SESSION_SECRET` to a generated high-entropy value.
- Set `FRONTEND_ORIGINS` to your deployed frontend origins if you use custom domains. The bundled regex already covers default `*.vercel.app` and `*.netlify.app` hosts.
- Set `OPENAI_API_KEY`, `GITHUB_TOKEN`, `SLACK_WEBHOOK_URL`, and Kubernetes credentials only when live integrations are needed.
- For Kubernetes on Render, prefer `KUBECONFIG_B64`: base64-encode the kubeconfig YAML and store that value as a Render secret. `KUBECONFIG_CONTENT` also works for hosts that safely support multiline secrets, while `KUBECONFIG` is for local/dev file paths.
- Render should use `/ready` as the health check because it verifies the database connection.
- `render.yaml` is backend-only and does not provision a Render database.

Railway can still be used for custom deployments, but it is not the primary
target for this repository.

### Required Production Environment

Backend:

```text
APP_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=<generated secret>
FRONTEND_ORIGINS=https://your-vercel-app.vercel.app,https://your-netlify-site.netlify.app
KUBECONFIG_B64=<base64-encoded kubeconfig for Render live mode>
KUBECONFIG_CONTENT=
KUBECONFIG=
```

Frontend:

```text
NEXT_PUBLIC_API_URL=https://your-backend.example.com
NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false
```

## Key Files

- `backend/main.py` - FastAPI API and incident workflows
- `backend/Dockerfile` - backend container build
- `backend/railway.toml` - Railway deployment config
- `render.yaml` - Render backend Blueprint using a Neon `DATABASE_URL` secret
- `netlify.toml` - Netlify frontend config for the `frontend/` app
- `docker-compose.yml` - full-stack container deployment with persistent PostgreSQL
- `nginx/conf.d/default.conf` - HTTPS-ready reverse proxy config
- `frontend/src/app/` - Next.js routes
- `frontend/Dockerfile` - frontend container build
- `frontend/vercel.json` - Vercel deployment config

## Future Roadmap

- Redis-backed rate limiting and request tracking
- SSO and organization-level audit controls
- Background workers for long-running recovery jobs
- Exportable incident reports and approvals
- Persistent observability integrations
