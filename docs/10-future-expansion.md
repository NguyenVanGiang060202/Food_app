# Food Discovery Platform - Future Expansion

## 1. Purpose

This document describes possible future expansion of the Food Discovery Platform. It is a roadmap, not an implementation commitment. Each initiative must be validated against user value, data availability, operating cost, legal requirements, and the architecture defined in the core documents.

The platform should grow by extending stable boundaries—provider adapters, canonical data, APIs, and client applications—rather than by coupling new features directly to a specific source, model, or client.

---

## 2. Expansion Principles

- Strengthen data quality and core discovery before adding product surfaces.
- Add sources through the crawler adapter contract, never through product-specific integrations.
- Keep PostgreSQL canonical data and public APIs as stable integration points.
- Validate new capabilities with bounded experiments before broad rollout.
- Measure operational cost, reliability, and user value before scaling a feature.
- Preserve privacy, source attribution, and data-retention requirements as the catalog grows.
- Avoid vendor lock-in by retaining replaceable provider and infrastructure boundaries.
- Do not add complexity before there is evidence that the current architecture cannot meet the need.

---

## 3. Roadmap Overview

```text
Foundation
    ↓
Reliable data collection and canonical catalog
    ↓
Search, maps, restaurant detail, and core API
    ↓
Hybrid search and recommendation quality
    ↓
Personalization and operational tooling
    ↓
Additional clients, sources, analytics, and ecosystem integrations
```

The phases may overlap, but a later phase should not undermine the reliability of earlier layers.

---

## 4. Phase 1: Foundation

### Objective

Establish a working local development environment and the minimum architecture required to ingest, store, and serve restaurant data.

### Scope

- Create frontend, backend, crawler, and database project foundations.
- Configure Docker Compose for local services.
- Implement PostgreSQL schema, migrations, and basic seed data.
- Implement one approved provider adapter with bounded crawl targets.
- Build validation, normalization, and canonical upsert flow.
- Expose basic restaurant and category APIs.
- Build a minimal web interface for list and detail views.

### Exit criteria

- A known bounded source dataset can be crawled, processed, and traced to canonical records.
- Restaurant list and detail views use the backend API successfully.
- Migrations, tests, linting, type checks, and local setup documentation work from a clean environment.

---

## 5. Phase 2: Discovery Quality

### Objective

Make the catalog useful for real restaurant discovery in a defined geographic area.

### Scope

- Add geographic search, map display, categories, price, rating, and open-now filters.
- Improve data completeness for addresses, coordinates, hours, images, and dishes.
- Add search indexes, fuzzy matching, and pagination.
- Add crawler scheduling, freshness tracking, retry handling, and operational metrics.
- Introduce admin views for provider status, crawl runs, and unresolved records.

### Exit criteria

- Users can reliably search and filter an active catalog within the target area.
- The system reports data freshness, crawl outcomes, validation failures, and unresolved matches.
- Search behavior is measured for latency, zero-result rate, and basic relevance.

---

## 6. Phase 3: AI-Assisted Discovery

### Objective

Add semantic understanding and recommendation assistance without making search dependent on an LLM.

### Scope

- Generate versioned restaurant search documents and embeddings.
- Implement hybrid retrieval using keyword, category, geographic, and vector signals.
- Add natural-language query interpretation with deterministic fallback.
- Enrich permitted records with controlled food and venue attributes.
- Provide grounded explanations for selected recommendation results.
- Build offline relevance evaluation datasets and monitor AI cost and quality.

### Exit criteria

- Hybrid search improves measured relevance for target query sets over keyword-only baseline.
- AI provider failures do not prevent basic search and discovery.
- Generated explanations are constrained to canonical evidence and monitored for unsupported claims.

---

## 7. Phase 4: Personalization

### Objective

Improve recommendation relevance using explicit, consented user preferences and interactions.

### Scope

- Add authentication, user profiles, dietary and cuisine preferences, and saved restaurants.
- Record privacy-aware interaction events such as saves, explicit feedback, and dismissals.
- Add personalized ranking signals and cold-start fallback behavior.
- Give users controls to view, edit, and remove their preferences where required.
- Evaluate personalization against non-personalized baseline results.

### Exit criteria

- Personalization is optional and does not degrade discovery for new or anonymous users.
- User data has defined ownership, retention, access control, and deletion behavior.
- Measured user outcomes justify the additional operational and privacy complexity.

---

## 8. Phase 5: Multi-Source Data Expansion

### Objective

Increase catalog coverage and data quality by adding approved data sources.

### Candidate sources

- Google Maps or other approved map/place sources.
- Food websites and review platforms.
- TikTok, YouTube, Facebook, and Instagram where collection and retention are permitted.
- Community contributions and restaurant-owner submissions.

### Requirements before enabling a source

1. Review source terms, access rules, privacy implications, and retention requirements.
2. Define the source's expected data value and operational cost.
3. Implement an isolated provider adapter, mapping, tests, and request policy.
4. Run a bounded pilot crawl and review completeness, duplicates, and parsing stability.
5. Configure source attribution, refresh cadence, monitoring, and a disable switch.
6. Confirm that the source improves canonical coverage or quality enough to justify its cost.

Additional sources must not create parallel product-specific restaurant models. All approved data flows through the existing source and pipeline model.

---

## 8.1 Deferred Feature: Persisted Conversation History

The current Ask Bếp experience keeps conversation turns in the browser session only. It does not synchronize conversation history with the backend or database, and this is intentional for the current scope.

Persisted conversation history may be considered later when there is clear user value and a defined privacy model. Before implementation, decide:

- Whether history is opt-in or enabled by default for authenticated users.
- Which data is stored: raw queries, filters, recommendation IDs, explanations, or only user-selected items.
- Retention, export, deletion, and account-offboarding behavior.
- Access control and protection for potentially sensitive dietary or location-related information.
- Whether saved conversations improve recommendations enough to justify storage and operational complexity.

Until those decisions are made, keep session-only history and do not add a database table or API contract for conversations.

---

## 9. Additional Client Applications

The backend API enables additional clients after the web experience and API contract are stable.

| Client             | Potential value                              | Prerequisites                                                   |
| ------------------ | -------------------------------------------- | --------------------------------------------------------------- |
| Mobile application | Native location and notification experience. | Stable API, authentication, map/search performance.             |
| Telegram bot       | Lightweight conversational discovery.        | Search/recommendation APIs and bot-specific rate limits.        |
| Discord bot        | Community discovery and group suggestions.   | Stable APIs, moderation, and command UX.                        |
| Public API         | Third-party integrations.                    | Strong authentication, quotas, documentation, and usage policy. |
| Admin dashboard    | Data quality and operational control.        | Audit logs, roles, and protected admin APIs.                    |

All clients consume the same canonical API. They may adapt presentation and interaction patterns but must not reimplement crawling, canonical matching, or core ranking.

---

## 10. Community and Restaurant Contributions

Community contributions can improve coverage, freshness, and local knowledge, but require moderation and anti-abuse controls.

Potential capabilities:

- Suggest a missing restaurant.
- Propose edits to hours, address, categories, and dishes.
- Upload permitted images or menu information.
- Flag an inaccurate, closed, duplicated, or inappropriate listing.
- Submit structured restaurant-owner claims or updates.

Requirements before launch:

- Contributor identity and abuse-prevention model.
- Moderation queue, audit history, and rollback capability.
- Clear attribution and content-licensing policy.
- Rate limits, validation, spam detection, and reporting tools.
- Separation between unverified submissions and publicly visible canonical facts.

Community data should enter the same quality pipeline as crawler data, with a distinct source type and review status.

---

## 11. Food Ontology and Richer Domain Data

The initial category model can expand into a food ontology that supports more precise discovery.

Potential additions:

- Cuisine, dish, ingredient, dietary, and allergen relationships.
- Meal type, preparation method, flavor profile, and regional-origin metadata.
- Restaurant attributes such as ambiance, accessibility, seating, parking, payment, and service style.
- Multilingual aliases and local-language food names.
- Confidence and provenance for every derived attribute.

Ontology work should begin with real search failures and high-value user intents, not with an attempt to model every possible food concept at once.

---

## 12. Advanced Recommendation Capabilities

After hybrid search and basic personalization are proven, the platform may add:

- Group recommendations that balance multiple preferences.
- Itinerary or meal-plan suggestions constrained by time and location.
- Trend detection from aggregated, permitted signals.
- Explainable diversity, such as varied cuisines or neighborhoods.
- Context-aware suggestions based on time of day, weather, or events where reliable data is available.
- Proactive recommendations through opt-in notifications.
- Continuous evaluation and controlled ranking experiments.

These features must remain explainable, bounded by trusted data, and optional for users.

---

## 13. Search and Infrastructure Scaling

The initial PostgreSQL, PostGIS, and pgvector design should be optimized and measured before introducing additional infrastructure.

Potential scale-out steps, only when justified:

| Trigger                   | Possible response                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------ |
| High read load            | Add caching, read replicas, or API horizontal scaling.                               |
| Large crawl workload      | Add independently scalable workers and provider-specific queues.                     |
| Growing vector workload   | Tune pgvector indexes, partition embeddings, or evaluate a dedicated vector service. |
| Complex text-search needs | Improve PostgreSQL search projections or evaluate a dedicated search engine.         |
| High analytics volume     | Export event data to a separate analytics store.                                     |
| Large image volume        | Use managed object storage and an image delivery pipeline.                           |

Any new service must have an owner, operational runbook, cost estimate, backup/recovery strategy, and a migration plan.

---

## 14. Reliability and Operations Maturity

As usage grows, the platform should add:

- Centralized structured logging, metrics, tracing, and alerting.
- Service-level objectives for API availability, search latency, queue delay, and data freshness.
- Database backup verification and tested restoration procedures.
- Deployment rollback and incident-response runbooks.
- Separate development, staging, and production environments.
- Rate-limit, quota, and budget controls for providers and AI services.
- Periodic security, dependency, and access-control reviews.

Operational maturity should grow with user impact and stored-data sensitivity.

---

## 15. Internationalization and Geographic Expansion

New cities or countries require more than translated UI strings. Before expansion, validate:

- Address, district, postal-code, and coordinate conventions.
- Local languages, transliteration, currency, and price presentation.
- Food categories, cuisine aliases, and local search vocabulary.
- Provider availability, collection terms, and data coverage.
- Privacy, consumer, and data-retention obligations.
- Map tiles, geocoding, and timezone handling.

The data model should use language codes, ISO country/currency codes, and timezone-aware timestamps from the beginning to reduce future migration effort.

---

## 16. Decision Gates

Expansion work requires a decision gate before implementation.

| Gate                 | Questions to answer                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- |
| User value           | What user problem does this solve, and how will success be measured?                |
| Data readiness       | Is the required data available, permitted, attributable, and sufficiently reliable? |
| Architecture fit     | Can it use existing modules and contracts without hidden coupling?                  |
| Operations           | What is the expected cost, support burden, failure mode, and rollback plan?         |
| Security and privacy | What data is added, who can access it, and how is it retained or deleted?           |
| Validation           | What bounded experiment or prototype can prove the assumption?                      |

If a proposal cannot pass these gates, it remains a documented idea rather than an implementation task.

---

## 17. Related Documents

- [00-project-overview.md](00-project-overview.md) — Vision, scope, and phased development strategy.
- [01-system-architecture.md](01-system-architecture.md) — Extensible system boundaries.
- [02-tech-stack.md](02-tech-stack.md) — Technology selection and replacement rules.
- [03-database-design.md](03-database-design.md) — Canonical data and future domain entities.
- [04-crawler-system.md](04-crawler-system.md) — Provider lifecycle and compliant data collection.
- [05-data-pipeline.md](05-data-pipeline.md) — Reprocessing and data-quality workflow.
- [06-backend-api-design.md](06-backend-api-design.md) — Client and integration API contracts.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Web-client growth and future surfaces.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — AI, personalization, and evaluation.
- [09-development-rules.md](09-development-rules.md) — Change-management and engineering standards.
