# ConnectSphere

Event management platform — Next.js/React frontend, Supabase-backed microservices.

## Repo layout

```
SPM-T5/
├── .github/
│   ├── workflows/            # CI pipelines (one per service + frontend, path-filtered)
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── apps/
│   └── web/                  # Next.js/React frontend
├── services/                 # One folder per microservice
│   ├── auth-service/
│   ├── event-service/
│   ├── venue-service/
│   ├── coordinator-service/
│   └── notification-service/
├── packages/
│   └── shared/                # Shared types, Supabase client, utils used by web + services
├── supabase/
│   ├── migrations/            # SQL migrations (source of truth for schema)
│   └── seed.sql
├── docs/
│   ├── architecture/
│   │   ├── c4/                 # C4 model (PlantUML) — context, container, component diagrams
│   │   └── adr/                # Architecture Decision Records
│   └── sprints/                # Sprint planning/retro notes
├── scripts/
└── docker-compose.yml          # Local dev: all services + supabase local stack
```

## Why this shape

- **Each service is independently testable and deployable.** `services/*` are standalone
  Node/TypeScript packages, each with their own `package.json`, `tests/`, and `Dockerfile`.
  This matches the microservice architecture and lets CI run only the tests affected by a
  given change (see path filters in `.github/workflows/`).
- **`packages/shared`** holds the Supabase client wrapper, generated DB types, and cross-cutting
  utilities (auth/role guards, validation schemas) so services and the frontend don't drift.
- **`apps/web`** is the Next.js app. It calls services directly (BFF-less) or through an API
  gateway if you add one later — start simple, add a gateway service only if you need it.
- **Automated testing runs on every push/PR**, scoped to whatever changed, so a new feature in
  `event-service` doesn't wait on unrelated frontend tests, and vice versa. See
  [`.github/workflows/README.md`](.github/workflows/README.md).
- **C4 diagrams live in `docs/architecture/c4`** as PlantUML source (`.puml`), version-controlled
  like code, and are auto-rendered to SVG/PNG by CI on every change (see
  [`docs/architecture/README.md`](docs/architecture/README.md)).

## Getting started

```bash
npm install          # installs all workspaces (npm workspaces monorepo)
cp .env.example .env # fill in your Supabase project URL/keys
docker compose up -d # local supabase + services (optional, for full-stack local dev)
npm run dev -w apps/web
```

## Testing

```bash
npm test -w apps/web
npm test -w services/event-service
npm run test:all          # every workspace
```

Every PR must pass its workflow's test job before merge (see branch protection notes in
`.github/workflows/README.md`).
