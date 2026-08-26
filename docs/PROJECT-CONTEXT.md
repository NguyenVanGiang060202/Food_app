# Project Context

> Fast entry point for AI agents working on Bếp. Keep this file short and update it when the project's direction or next work changes.

## What this project is

Bếp is a food-discovery platform that helps people turn cravings into restaurant shortlists. The repository contains the frontend, backend API, crawler/data pipeline, database assets, and the project's canonical engineering/design documentation.

## Canonical knowledge

- Architecture and technical decisions: `docs/01-system-architecture.md`, `docs/02-tech-stack.md`.
- Database: `docs/03-database-design.md`.
- Crawler and data pipeline: `docs/04-crawler-system.md`, `docs/05-data-pipeline.md`.
- Backend/API: `docs/06-backend-api-design.md`, `docs/11-api-contracts.md`.
- Frontend: `docs/07-frontend-architecture.md`, `docs/20-frontend-release-checklist.md`.
- AI/recommendation: `docs/08-ai-recommendation-system.md`.
- Security/testing/deployment: `docs/14-security.md`, `docs/15-testing-strategy.md`, `docs/16-deployment.md`.
- Product/design/data-display policy: `docs/18-food-discovery-design-strategy.md`, `docs/19-data-display-policy.md`, `docs/21-brand-voice.md`.
- Current roadmap: `docs/19-next-work-roadmap.md`.

When documents conflict, follow the most specific and most recently updated project decision; do not treat this file as a replacement for the canonical docs.

## Agent working rules

1. Read this file first, then open only the canonical docs relevant to the task.
2. Before changing architecture, API contracts, database shape, security rules, or product behavior, check the corresponding canonical document.
3. Prefer small, verifiable changes. Run the narrowest relevant checks, then the repository checks when practical.
4. Never commit secrets or local runtime artifacts. `.env` and database dumps are intentionally ignored.
5. Update the relevant canonical document when an implementation changes a documented decision.

## Context packaging

Repomix is used as an optional AI-context packaging layer. It creates a compact, token-counted snapshot for agents; it is **not** the source of truth. The source of truth remains the repository and `docs/`.

## Refresh

Run `npm run context:pack` to regenerate the AI context snapshot in `tmp/ai-context/`. The generated snapshot is local-only and is ignored by Git.

## Next work

Use `docs/19-next-work-roadmap.md` as the authoritative task queue. Do not invent a competing roadmap in this file.
