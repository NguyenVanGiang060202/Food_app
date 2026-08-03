# Food Discovery Platform - Development Rules

## 1. Purpose

This document defines the engineering rules for building and maintaining the Food Discovery Platform. These rules apply to frontend, backend, crawler, database, infrastructure, tests, and documentation.

The goal is to keep the project modular, understandable, safe to change, and aligned with the architecture documents. Documentation defines intended architecture; implementation must follow it or update it through an approved change.

---

## 2. Core Rules

- Read the relevant documents in `docs/` before starting work.
- Preserve the boundaries between frontend, backend, crawler, pipeline, and database responsibilities.
- Prefer small, reviewable, reversible changes.
- Do not introduce a new architectural dependency without documenting its purpose and impact.
- Do not bypass validation, authorization, source attribution, or data-quality controls for convenience.
- Treat user data, provider data, credentials, and AI prompts as sensitive by default.
- Keep business rules in domain services, not in UI components, database triggers, or ad hoc scripts.
- Write tests in proportion to risk and verify every implemented change.

---

## 3. Repository Structure

The repository is organized by responsibility:

```text
food-app/
├── backend/      # NestJS API, domain services, workers, and tests
├── crawler/      # Provider adapters and crawler workers
├── database/     # Schema, migrations, seeds, and database utilities
├── frontend/     # React web application
├── docs/         # Architecture and development documentation
└── README.md     # Repository introduction and setup entry point
```

Code must remain in the appropriate area. For example, a provider parser belongs in `crawler/`, a canonical database migration belongs in `database/`, and a search-results component belongs in `frontend/`.

Cross-cutting shared contracts should be introduced deliberately. Do not create a broad shared package until multiple consumers have a stable, demonstrated need.

---

## 4. Documentation-First Changes

Architecture, data model, API contract, crawler behavior, and technology changes must be documented before or in the same change set as the implementation.

Update the relevant document when changing:

| Change                                                 | Required documentation           |
| ------------------------------------------------------ | -------------------------------- |
| System boundary or service responsibility              | `01-system-architecture.md`      |
| Runtime technology or managed dependency               | `02-tech-stack.md`               |
| Database entity, constraint, or index                  | `03-database-design.md`          |
| Provider adapter or collection policy                  | `04-crawler-system.md`           |
| Ingestion, matching, enrichment, or reprocessing logic | `05-data-pipeline.md`            |
| Public API contract                                    | `06-backend-api-design.md`       |
| Web-client architecture or user flow                   | `07-frontend-architecture.md`    |
| Search, ranking, embedding, or AI behavior             | `08-ai-recommendation-system.md` |
| Engineering standards                                  | This document                    |

When a decision is still uncertain, document the assumption and the validation needed rather than presenting it as final.

---

## 5. Code Quality

### General

- Use TypeScript for application and crawler code unless a documented exception is necessary.
- Enable strict TypeScript settings for new code.
- Use descriptive names that reflect business intent.
- Keep functions focused; extract cohesive units instead of creating large multi-purpose services.
- Avoid hidden side effects and mutable global state.
- Prefer explicit types at public boundaries, including API DTOs, queue payloads, and provider records.
- Do not use `any` except in tightly contained interoperability code with a documented reason.
- Remove dead code and unused dependencies in the same change when safe.

### Formatting and linting

- Use a shared formatter and linter configuration per application.
- Do not manually reformat unrelated files in a functional change.
- Automated formatting must run before committing changed code.
- Lint warnings that indicate correctness or maintainability issues must be resolved, not suppressed without explanation.

### Comments

Comments explain non-obvious intent, constraints, or tradeoffs. They do not restate code. Public modules, unusual algorithms, provider-specific workarounds, and non-trivial database queries require concise documentation.

---

## 6. Module and Dependency Rules

- Controllers handle transport concerns; services own business rules; repositories/data-access layers own persistence queries.
- Frontend components render UI and delegate API interaction to feature hooks or API clients.
- Crawler adapters isolate provider-specific selectors, request behavior, and parsing.
- Pipeline workers are asynchronous and idempotent.
- Domain modules must not import presentation components or crawler implementation details.
- Avoid circular dependencies. If one appears, revise module boundaries rather than hiding it with lazy imports.
- External SDK calls must be wrapped behind project-owned adapters when they affect core business behavior, such as AI providers or data sources.

---

## 7. API Rules

- Public endpoints use versioned `/api/v1` routes.
- Validate all route parameters, query parameters, headers, and request bodies.
- Use `camelCase` JSON fields and consistent error responses.
- Never expose database internals, raw source payloads, stack traces, secrets, or restricted data.
- Use pagination and bounded filter values for collection endpoints.
- Apply authentication and authorization on the backend for protected actions; frontend guards are only a user-experience layer.
- Document API changes and update OpenAPI contracts and tests together.
- Preserve backward compatibility within a version whenever feasible; use a new version for breaking changes.

API details are defined in [06-backend-api-design.md](06-backend-api-design.md).

---

## 8. Database Rules

- PostgreSQL is the canonical source of truth for application data.
- Make every schema change through a version-controlled migration.
- Never edit an applied production migration; create a corrective migration.
- Use UUID primary keys, `snake_case` database names, foreign keys, and appropriate constraints.
- Add indexes based on documented query paths, then verify their value through testing or measurement.
- Do not use database triggers for core business workflows unless the architecture explicitly requires them.
- Keep database transactions short and avoid network or AI calls inside transactions.
- Preserve source provenance and do not destructively overwrite imported facts without a documented merge rule.
- Test migrations against a clean database and an upgrade path from the current schema.

Database design is defined in [03-database-design.md](03-database-design.md).

---

## 9. Crawler and Pipeline Rules

- Only collect data from sources approved for the project and according to applicable terms and policies.
- Use bounded crawl targets, provider-specific rate limits, timeouts, and retry rules.
- Never bypass CAPTCHAs, authentication restrictions, paywalls, robots policies, or other access controls.
- Preserve provider code, external ID, source URL, and collection time for all imported records.
- Treat provider external IDs as unique only within the provider.
- Crawler code emits provider-neutral source records; it does not decide final canonical matches.
- Pipeline stages must be idempotent, observable, and safe to retry.
- AI enrichment must be versioned, validated, and distinguishable from source or manually curated facts.
- Raw provider data retention must be minimal and policy controlled.

Crawler and pipeline behavior are defined in [04-crawler-system.md](04-crawler-system.md) and [05-data-pipeline.md](05-data-pipeline.md).

---

## 10. AI Rules

- Use AI as an enhancement layer for interpretation, enrichment, semantic retrieval, and explanation—not as the canonical database or sole search engine.
- Require structured outputs and schema validation for AI-generated data.
- Keep model/provider calls behind an internal abstraction.
- Do not send secrets, raw provider payloads, restricted reviews, or unnecessary user data to an AI provider.
- Record model/version and pipeline version for generated outputs.
- Do not allow generated text to claim facts absent from the supplied canonical evidence.
- Provide deterministic fallback behavior when an AI service fails or is unavailable.
- Measure quality, latency, usage, and cost before expanding AI features.

AI behavior is defined in [08-ai-recommendation-system.md](08-ai-recommendation-system.md).

---

## 11. Security and Privacy Rules

- Store credentials in environment variables or an approved secrets manager; never commit them.
- Maintain `.env.example` files with variable names and safe placeholders only.
- Rotate exposed or suspected-exposed credentials immediately.
- Use HTTPS in production and approved CORS origins.
- Validate and sanitize all external input and untrusted display content.
- Apply least-privilege access to databases, queues, providers, and administrative interfaces.
- Do not log passwords, session tokens, API keys, cookies, full raw payloads, or sensitive personal data.
- Minimize collected user data and define retention before introducing new user-tracking behavior.
- Run dependency and security updates regularly; prioritize vulnerabilities with real exposure.

---

## 12. Testing Rules

Every change must have verification appropriate to its risk.

| Change type                     | Minimum verification                                |
| ------------------------------- | --------------------------------------------------- |
| Pure utility or formatter       | Unit tests.                                         |
| Backend service or API endpoint | Unit tests plus integration/API tests.              |
| Database migration              | Migration test against clean and upgrade databases. |
| Provider parser                 | Fixture-based parsing and contract tests.           |
| Pipeline or queue worker        | Idempotency, retry, and failure-path tests.         |
| Frontend component              | Component tests including loading/error states.     |
| Core user journey               | End-to-end test for the affected path.              |
| AI/ranking behavior             | Schema, fallback, and offline-evaluation tests.     |

- Tests must be deterministic and independent of external production systems.
- Use fixtures, mocks, and isolated test databases where appropriate.
- A test that fails intermittently is a defect; fix or quarantine it with a tracked reason.
- New defects should receive a regression test when practical.

---

## 13. Git and Change Management

- Keep commits focused on one coherent change.
- Use concise imperative commit messages, for example `Add restaurant search filters`.
- Do not mix broad refactoring with an unrelated feature or bug fix.
- Rebase or merge according to the team workflow without rewriting shared history.
- Review the final diff before committing.
- Do not commit generated secrets, local build output, database dumps, or large unapproved binary assets.
- Add migration files, API documentation, and tests to the same pull request when they are part of the change.

Pull requests should describe the problem, solution, architecture impact, verification performed, migration or deployment steps, and known limitations.

---

## 14. Code Review Checklist

Reviewers and authors should confirm:

- The change follows the documented architecture.
- Responsibilities remain in the correct module/layer.
- Input validation, authorization, and error handling are complete.
- Data provenance and idempotency are preserved where data is imported or processed.
- Sensitive data and secrets are handled safely.
- Tests cover the key happy path and failure behavior.
- Database migrations and indexes are safe and justified.
- User-visible loading, empty, error, and accessibility states are present.
- Documentation and API contracts reflect the implementation.
- The scope is focused and unrelated changes are excluded.

---

## 15. Definition of Done

A task is complete only when:

1. The requested behavior is implemented within the documented architecture.
2. Relevant tests, linting, type checks, and builds pass.
3. The change is verified manually when automated tests do not cover the user-visible behavior.
4. Documentation, API contracts, migrations, and configuration examples are updated where needed.
5. Errors, security implications, and rollback or retry behavior are considered.
6. The final diff contains no debug code, secrets, unnecessary generated files, or unrelated changes.

---

## 16. Windows PowerShell Command Safety

The development environment may execute commands through Windows PowerShell 5.1.
Use these rules for all future CLI work:

- Do not put Vietnamese text or other non-ASCII user-facing query strings directly in PowerShell commands, search expressions, or inline request bodies; this has previously caused the terminal to hang.
- Keep shell commands and query parameters ASCII-only. Read Vietnamese content from source files with repository tools instead of embedding it in a shell command.
- Use `;` to separate PowerShell commands. Do not use `&&`, which is unsupported by Windows PowerShell 5.1.
- Prefer repository tools for file reads/searches and use CLI commands only for validation, builds, tests, and other necessary operations.
- When an API request needs Vietnamese data, send it from a file or use an application-level fixture rather than typing the string into the shell.
- Do not send JSON with `--data-raw "{\"query\":\"...\"}"` from PowerShell. Windows PowerShell 5.1 strips the escaped double quotes, so the server receives malformed JSON and returns `400 VALIDATION_ERROR` (`Expected property name or '}' in JSON`); inline Vietnamese can also hang the terminal. Write the body to a UTF-8 (no BOM) file and use `-d @file` instead:

  ```powershell
  # body.json (UTF-8, no BOM)
  {"query":"phở","limit":6,"filters":{"taste":[],"openNow":false}}
  curl.exe -sS -i -X POST http://localhost:3000/api/v1/recommendations -H "Content-Type: application/json" -d "@body.json"
  ```

  Create a UTF-8 no-BOM body file from PowerShell:

  ```powershell
  [System.IO.File]::WriteAllText("body.json", $json, (New-Object System.Text.UTF8Encoding($false)))
  ```

---

## 17. Related Documents

- [00-project-overview.md](00-project-overview.md) — Project goals and philosophy.
- [01-system-architecture.md](01-system-architecture.md) — Architectural boundaries.
- [03-database-design.md](03-database-design.md) — Database standards and schema model.
- [04-crawler-system.md](04-crawler-system.md) — Collection restrictions and adapter rules.
- [05-data-pipeline.md](05-data-pipeline.md) — Processing and data-quality rules.
- [06-backend-api-design.md](06-backend-api-design.md) — API standards.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Frontend conventions.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — AI constraints and evaluation.
- [10-future-expansion.md](10-future-expansion.md) — Planned future capabilities.
