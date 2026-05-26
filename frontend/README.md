# DevPilot AI Frontend

Next.js app deployed on Vercel and Netlify.

## Environment

Copy `.env.example` to `.env.local` for local development.

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false
```

For Vercel production, set the project root to `frontend/` and set
`NEXT_PUBLIC_API_URL` to the HTTPS URL of the Render backend. Keep
`NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false` unless live Kubernetes reads are
intentionally enabled.

For Netlify production, use the repo root with `netlify.toml`; it builds this
directory with the same `npm run build` command and applies
`NPM_FLAGS=--legacy-peer-deps`.

The intended build runtime is Node.js 22, declared in `package.json`.

## Commands

```bash
npm ci
npm run dev
npm run build
```
