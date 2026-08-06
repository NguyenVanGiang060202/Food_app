# Food Discovery Platform - Folder Structure

## 1. Purpose

This document defines the initial repository layout and ownership boundaries. The structure favors independently runnable applications with clear responsibility boundaries over an early, overly generic shared-code system.

---

## 2. Repository Layout

```text
food-app/
├── backend/
├── crawler/
├── database/
├── frontend/
├── docs/
├── docker-compose.yml
├── .env.example
├── README.md
└── package.json                 # Optional workspace root tooling
```

| Directory   | Ownership                                                    |
| ----------- | ------------------------------------------------------------ |
| `backend/`  | NestJS API, domain services, queue producers, and API tests. |
| `crawler/`  | Provider adapters and crawler worker runtime.                |
| `database/` | Database schema, migrations, seeds, and database utilities.  |
| `frontend/` | React web application and frontend tests.                    |
| `docs/`     | Architecture, contracts, operational rules, and setup docs.  |

---

## 3. Backend Structure

```text
backend/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── config/
│   ├── common/                 # guards, filters, interceptors, utilities
│   ├── database/               # Prisma/database provider and repositories
│   ├── modules/
│   │   ├── health/
│   │   ├── restaurants/
│   │   ├── search/
│   │   ├── categories/
│   │   ├── recommendations/
│   │   ├── users/
│   │   └── admin/
│   └── workers/                # API-owned async workers, if any
├── test/
├── prisma/                     # only if Prisma is owned by backend
├── .env.example
└── package.json
```

Each domain module may contain `controller`, `service`, `dto`, `repository`, and `*.spec.ts` files as needed. Controllers do not contain business logic. Database queries do not appear in UI-facing controllers.

---

## 4. Crawler Structure

```text
crawler/
├── src/
│   ├── main.ts
│   ├── config/
│   ├── providers/
│   │   ├── provider.interface.ts
│   │   └── {provider-code}/
│   │       ├── adapter.ts
│   │       ├── parser.ts
│   │       ├── mapper.ts
│   │       └── fixtures/
│   ├── jobs/
│   ├── queue/
│   ├── lib/
│   └── types/
├── test/
├── .env.example
└── package.json
```

Provider code, selectors, request formats, and fixtures remain inside its provider directory. The crawler emits source records; it does not own canonical matching or API responses.

---

## 5. Database Structure

```text
database/
├── migrations/
├── seeds/
├── schema/                     # optional SQL/schema reference files
├── scripts/                    # safe operational helpers
├── test-data/
└── README.md
```

Choose one clear migration owner. If Prisma owns schema and migrations, place its schema/migrations under `backend/prisma/` and keep `database/` for seeds, extension setup, SQL utilities, and documentation. Do not maintain duplicate competing schemas.

---

## 6. Frontend Structure

```text
frontend/
├── src/
│   ├── app/                    # providers, router, layouts
│   ├── features/               # feature-oriented UI
│   │   ├── search/
│   │   ├── restaurants/
│   │   ├── recommendations/
│   │   ├── auth/
│   │   ├── profile/
│   │   └── admin/
│   ├── components/
│   │   ├── ui/                 # generic primitives
│   │   └── shared/             # cross-feature components
│   ├── lib/                    # API client, formatters, validation
│   ├── hooks/
│   ├── styles/
│   ├── types/
│   ├── main.tsx
│   └── vite-env.d.ts
├── public/
├── test/
├── .env.example
└── package.json
```

Avoid a single global `components/` directory full of feature-specific components. Place those in their owning feature.

---

## 7. Shared Code Rule

Shared code is introduced only after two or more applications have a stable identical need. Candidate shared packages include API-generated types, validation schemas, or a source-record contract.

```text
packages/
├── api-types/                  # generated or versioned contract types
└── source-contracts/           # crawler → pipeline contract, if needed
```

Do not share database clients, backend services, frontend components, or provider implementations across applications merely to reduce imports.

---

## 8. Naming Rules

- Directories and non-component files use `kebab-case`.
- React components use `PascalCase.tsx`.
- TypeScript variables/functions use `camelCase`; classes/types use `PascalCase`.
- Tests use `*.spec.ts` or `*.test.ts[x]` consistently per app.
- Environment files use `.env`, `.env.example`, and environment-specific ignored variants.
- Database objects use `snake_case` as defined in `03-database-design.md`.

---

## 9. Related Documents

- [09-development-rules.md](09-development-rules.md) — Code and module rules.
- [17-environment-setup.md](17-environment-setup.md) — Local services and environment files.
- [16-deployment.md](16-deployment.md) — Runtime service topology.
