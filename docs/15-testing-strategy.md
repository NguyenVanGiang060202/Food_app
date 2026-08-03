# Food Discovery Platform - Testing Strategy

## 1. Purpose

This document defines how the platform is verified across frontend, backend, crawler, pipeline, database, and deployment boundaries. Tests provide fast feedback, while manual checks and staged environments validate behavior that cannot be safely or realistically automated.

---

## 2. Principles

- Test behavior and contracts, not private implementation details.
- Use the smallest test layer that can confidently prove a requirement.
- Keep tests deterministic, isolated, and independent of live providers.
- Test failure paths, retries, authorization, and data quality—not only happy paths.
- Add regression coverage for important defects when practical.
- Run automated checks in CI before merge.

---

## 3. Test Pyramid

```text
        End-to-end tests
    Integration / contract tests
Unit and component tests
```

Most coverage belongs in unit/component and integration tests. End-to-end tests cover a small number of critical user journeys and must remain stable.

---

## 4. Backend Tests

| Layer       | What to test                                                                        |
| ----------- | ----------------------------------------------------------------------------------- |
| Unit        | Domain services, score calculations, DTO mapping, validation utilities.             |
| Integration | Controllers, database repositories, authorization, pagination, and error envelopes. |
| Contract    | OpenAPI routes, request/response schemas, status codes, and compatibility.          |
| Worker      | Queue payload validation, idempotency, retry classification, and failure handling.  |

Backend integration tests use a dedicated test database and Redis instance. They never use production credentials or live crawler targets.

---

## 5. Database Tests

- Apply migrations to an empty database.
- Apply migrations as an upgrade from the current schema baseline.
- Verify required extensions, constraints, indexes, and seed behavior.
- Test critical geospatial, full-text, and vector queries with known fixtures.
- Verify rollback/recovery only where the migration tooling supports it safely.

Every migration should be exercised in CI or an equivalent isolated environment.
The CI database job builds the repository PostgreSQL image from a clean volume,
waits for readiness, and verifies the required extensions, core tables, role
constraint, and restaurant-image uniqueness index. Upgrade-path validation remains
covered by the PowerShell migration runner and should be exercised against a
representative existing database before a release.

---

## 6. Crawler and Pipeline Tests

| Area                   | Required coverage                                                          |
| ---------------------- | -------------------------------------------------------------------------- |
| Provider parser        | Fixture-based parsing of known source responses/pages.                     |
| Adapter contract       | Required provenance fields and valid source-record output.                 |
| Error classification   | Timeout, rate-limit, parse, configuration, and restricted-access behavior. |
| Pipeline normalization | Names, addresses, coordinates, ratings, categories, and hours.             |
| Matching               | Exact, high-confidence, ambiguous, and non-match cases.                    |
| Idempotency            | Reprocessing does not create duplicate source/canonical records.           |
| Enrichment             | Schema validation, model fallback, and source-fact protection.             |

Live provider integration tests are avoided by default. Any approved smoke test must be bounded, manually controlled, credential-safe, and compliant with source policy.

---

## 7. Frontend Tests

| Layer               | What to test                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| Unit                | Formatters, URL/filter parsers, and pure UI logic.                     |
| Component           | Forms, cards, loading states, errors, empty states, and accessibility. |
| Feature integration | Search, filters, API-cache behavior, save actions, and route state.    |
| End-to-end          | Core visitor search → detail; sign-in → save; approved admin flow.     |

Component tests use accessible selectors and assert user-visible behavior. API responses are mocked using contract-aligned fixtures.

---

## 8. AI and Ranking Evaluation

- Test query interpretation against a curated set of natural-language inputs and expected schema outputs.
- Test deterministic fallback when AI services time out or return invalid output.
- Evaluate ranking with curated query-to-relevant-restaurant judgments using metrics such as Recall@K and NDCG@K.
- Verify explanations are grounded only in supplied canonical facts.
- Track model/version, latency, cost, and error rate in non-test environments.

AI quality tests must not rely solely on exact generated wording; test schema, evidence constraints, and outcome quality instead.

---

## 9. CI Quality Gates

Every pull request should run applicable checks:

```text
format check → lint → type check → unit/component tests
→ integration/contract tests → build → migration validation
```

Failures block merge unless explicitly waived with a documented, time-bounded reason. Security/dependency checks run in CI as defined in [14-security.md](14-security.md).

---

## 10. Test Data and Fixtures

- Use synthetic or approved, minimal fixtures.
- Never commit secrets or private provider/user data.
- Keep fixtures readable and versioned near their owning feature or provider.
- Use factories/builders for test entities with valid defaults.
- Include edge cases: missing fields, duplicate names, mixed languages, invalid coordinates, late-night hours, and closed venues.

---

## 11. Manual Verification

Manual verification is required for map interactions, responsive behavior, browser geolocation permission flows, visual accessibility checks, bounded crawler smoke tests, and production deployment validation.

Document the commands or steps performed in the pull request when manual verification is needed.

---

## 12. Related Documents

- [09-development-rules.md](09-development-rules.md) — Definition of done.
- [11-api-contracts.md](11-api-contracts.md) — API contract coverage.
- [14-security.md](14-security.md) — Security verification.
- [16-deployment.md](16-deployment.md) — Release validation.
