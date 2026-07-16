# ORPOS Deploy

Internal Windows register deployment dashboard for ORPOS client installs over PowerShell Remoting / WinRM.

## Stack (MVP)

- **Web**: React + Vite + TypeScript
- **API**: Fastify + JWT auth
- **Worker**: Node lease/throttle worker with **simulate** mode (Linux/dev) and PowerShell script for Windows WinRM (`scripts/ps/Invoke-OrposDeploy.ps1`)
- **DB**: SQLite via Prisma 7 (swap `DATABASE_URL` to PostgreSQL for production)

## Quick start

```bash
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:3001/api/v1/health

### Default users

| User | Password | Role |
|---|---|---|
| admin | admin123 | ADMIN |
| operator | operator123 | OPERATOR |
| auditor | auditor123 | AUDITOR |

## Apps

| Path | Purpose |
|---|---|
| `apps/web` | Dashboard, inventory, new deployment, job detail, schedules, logs, settings |
| `apps/api` | REST API `/api/v1/*` |
| `apps/worker` | Claims queued targets, runs pipeline, fires schedules |
| `packages/shared` | Hostname parse, backup naming, defaults |
| `packages/db` | Prisma client helper |
| `docs/ORPOS-DEPLOYMENT-DESIGN.md` | Full product/technical design |

## Deploy modes

- `DEPLOY_MODE=simulate` (default): worker simulates WinRM steps, log verdicts, and rollback. Register `045` fails install then rolls back for demos.
- `DEPLOY_MODE=winrm`: use on a Windows worker host with the PowerShell script against real registers.

## Design reference

See [docs/ORPOS-DEPLOYMENT-DESIGN.md](./docs/ORPOS-DEPLOYMENT-DESIGN.md) for PRD, schema, API contracts, and UX specs.
