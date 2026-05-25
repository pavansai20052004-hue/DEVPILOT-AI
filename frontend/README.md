# DevPilot AI Frontend

Next.js app deployed on Vercel.

## Environment

Copy `.env.example` to `.env.local` for local development.

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN=false
```

For Vercel production, set `NEXT_PUBLIC_API_URL` to the HTTPS URL of the
Railway or Render backend. The build validates this value before `next build`.

## Commands

```bash
npm ci
npm run dev
npm run build
```
