# Food Discovery Platform - AI Recommendation System

## 1. Purpose

This document defines how the Food Discovery Platform uses search, ranking, embeddings, and generative AI to recommend restaurants and food experiences.

The system is retrieval-first. It searches the internal canonical catalog, applies deterministic filters and ranking signals, then optionally uses AI to interpret user language, enrich metadata, or explain the highest-ranked results. A large language model is not the primary search engine and must not be the source of truth for restaurant facts.

---

## 2. Goals

- Understand restaurant and food requests expressed in natural language.
- Return relevant, geographically appropriate, and high-quality candidates.
- Combine keyword, structured, geospatial, and semantic retrieval.
- Support future personalization without requiring it for useful initial results.
- Generate concise, evidence-grounded explanations when helpful.
- Keep model cost, latency, privacy, and quality measurable.

---

## 3. Non-Goals

The AI recommendation system does not:

- Invent restaurant facts, menus, opening hours, prices, or reviews.
- Replace canonical database queries with free-form model output.
- Make final moderation or data-quality decisions without deterministic rules or human review.
- Require users to disclose sensitive information to receive basic recommendations.
- Send raw provider payloads, secrets, or unnecessary personal data to AI providers.

---

## 4. System Overview

```text
User query + optional context
        ↓
Query validation and normalization
        ↓
Optional AI query interpretation
        ↓
Structured filters + retrieval plan
        ↓
Hybrid candidate retrieval
  ├── keyword / full-text search
  ├── category and attribute filters
  ├── geospatial search
  └── vector similarity search
        ↓
Candidate fusion and deterministic ranking
        ↓
Optional personalization adjustment
        ↓
Top results
        ↓
Optional grounded AI explanation
        ↓
API response
```

Every result returned to a client must reference a canonical restaurant ID. Generated text is supplementary metadata attached to a retrieved result, never a replacement for it.

---

## 5. Input and Context

The recommendation request can include:

| Input               | Example                                 | Use                                  |
| ------------------- | --------------------------------------- | ------------------------------------ |
| Free-text query     | “Quiet coffee shop for working”         | Primary user intent.                 |
| Coordinates         | Latitude and longitude                  | Nearby search and distance ranking.  |
| Geographic filter   | City, district, radius                  | Search scope.                        |
| Structured filters  | Price level, category, rating, open now | Hard constraints or ranking signals. |
| Time context        | Current local time                      | Opening-status checks when reliable. |
| User preferences    | Vegetarian, favorite cuisines           | Optional personalization.            |
| Interaction history | Saved or dismissed restaurants          | Optional preference signal.          |

Input validation and privacy controls occur before any AI-provider call. Geographic and user context are optional; the system must work without them.

---

## 6. Query Understanding

The system first applies deterministic parsing for known filters and terms. An optional AI interpretation step handles ambiguous natural language or converts user phrasing into supported structured fields.

Example:

```text
Input: “A quiet Italian restaurant in District 1 for a date”

Normalized intent:
  category: italian
  district: District 1
  desiredAttributes: [quiet, date-friendly]
  unsupportedIntent: []
```

### Requirements

- AI output must conform to a strict schema.
- Only supported fields may become filters.
- The original query remains available as a keyword and semantic-search input.
- Uncertain fields must not become hard filters by default.
- The system must fall back to deterministic retrieval if the AI provider is unavailable, times out, or returns invalid output.
- Query interpretation is logged with model/version and safe metadata for quality evaluation.

---

## 7. Search Documents and Embeddings

### Search document

Each eligible canonical restaurant has a derived search document. It may combine:

- Restaurant name and normalized aliases.
- Categories and food ontology labels.
- Curated description and approved attributes.
- Dish names and descriptions.
- Location context, such as district and city.
- Permitted aggregated review insights.

The document must exclude restricted raw content, personal data, and unverified model claims.

### Embeddings

An embedding is generated from a versioned search-document representation and stored in `restaurant_embedding`.

```text
Canonical data changes
        ↓
Build deterministic embedding input
        ↓
Calculate content hash
        ↓
Generate embedding only when hash/model changed
        ↓
Store vector + model metadata
```

Query embeddings are generated only for semantic-search requests that benefit from them. The embedding model, dimension, distance metric, and document template must be versioned together.

---

### Runtime intent understanding

"Hỏi bếp" turns a user's free-form Vietnamese into grounded SQL filters. The
runtime LLM (`backend/src/modules/ai/`) parses the text into a bounded, validated
JSON intent whose `categories` are restricted to the real category taxonomy
(loaded from the database), then the existing keyword/structured retrieval in
`RestaurantsRepository.list` selects the restaurants. The LLM never names
restaurants directly, so it cannot invent candidates.

- The provider is OpenAI-compatible (`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`,
  default Gemini's OpenAI-compatible endpoint).
- Every field is validated and rejected outside its contract (`category` slugs
  only from the DB, `priceLevel` 1–4, `minRating` 3.0–5.0, `distanceKm` 1–60,
  district as `Quận N`).
- Provider outages, timeouts, or malformed responses return `null` and the
  request uses the deterministic `interpretQuery` rules instead; retrieval
  always falls through the same rank/fallback ladder.
- `POST /search/interpret` exposes the parsed filters plus an `aiSummary` the
  frontend renders as "Bếp nghe hiểu: …".

## 8. Hybrid Candidate Retrieval

Candidate retrieval combines complementary methods rather than depending on a single score.

| Retrieval source               | Best for                                                   | Notes                                                  |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| Keyword/full-text search       | Exact restaurant or dish names, direct terms.              | Uses normalized text and searchable document fields.   |
| Category and attribute filters | Explicit cuisine, dietary, price, and feature constraints. | Hard filters apply before broad ranking when reliable. |
| Geospatial search              | Nearby places and geographic boundaries.                   | Uses PostGIS and a bounded radius.                     |
| Vector similarity              | Intent and concept similarity beyond exact keywords.       | Uses pgvector embeddings.                              |
| Popularity/quality candidates  | Broad discovery with weak query intent.                    | Must not dominate relevance or distance.               |

Each retrieval source returns a bounded candidate set. Candidate IDs are merged and deduplicated before ranking. The system should preserve source scores internally for evaluation but not expose unstable raw scores as a public contract.

---

## 9. Filtering Rules

Hard filters narrow the candidate set only when the data is trustworthy enough. Initial hard filters can include:

- Active restaurant status.
- Explicit category selection.
- Geographic boundary or radius.
- Valid price level when requested.
- Minimum rating when rating data exists.
- Open-now status when regular hours are complete and reliable.

Soft preferences, such as “quiet,” “good for dates,” or “popular,” should remain ranking signals until the data model has sufficient confidence and coverage to treat them as strict filters.

The response should make it clear when a requested filter could not be enforced because the catalog lacks reliable data.

---

## 10. Ranking Model

After retrieval and hard filtering, the system calculates a transparent composite ranking score.

```text
finalScore =
  relevanceScore
  + semanticSimilarityScore
  + categoryMatchScore
  + attributeMatchScore
  + qualityScore
  + preferenceScore
  + freshnessScore
  - distancePenalty
```

The actual formula and weights are configuration, not frontend code. They must be versioned and adjustable through controlled experiments.

| Signal                  | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| Relevance               | Keyword/full-text match to the original query.                      |
| Semantic similarity     | Vector similarity between query and restaurant search document.     |
| Category and attributes | Match to explicit and inferred intent.                              |
| Distance                | Geographic proximity, subject to user context and requested radius. |
| Quality                 | Rating, review volume, data completeness, and source confidence.    |
| Preference              | Match to explicit user preferences and trusted interaction signals. |
| Freshness               | Recency of verified source data where relevant.                     |
| Diversity               | Optional penalty to avoid near-duplicate results.                   |

No single signal should dominate without product approval. Ranking changes require offline evaluation before broad release.

---

## 11. Personalization

Personalization is introduced after the platform has explicit user preferences and sufficient consented interaction data.

### Initial signals

- Saved restaurants and explicitly selected categories.
- Dietary preferences and cuisine preferences.
- Preferred price range and location context.
- Explicit positive or negative feedback.

### Rules

- Personalization must be additive; it must not hide clearly relevant results without a product decision.
- Users must be able to view and edit explicit preferences.
- Sensitive attributes must not be inferred or used without a defined policy and consent model.
- New users receive a non-personalized contextual ranking.
- User interaction data is separated from source data and subject to retention controls.

---

## 12. AI-Generated Explanations

Explanations are generated only after the system has selected final candidate results.

The generation prompt receives a minimal, structured evidence set, for example:

```text
User request: quiet Italian restaurant in District 1
Restaurant facts:
  name: Example Restaurant
  categories: Italian
  location: District 1
  rating: 4.5
  known attributes: quiet, date-friendly
```

Requirements:

- Use only supplied canonical facts.
- Clearly avoid claims about missing or uncertain data.
- Keep explanations concise and user-focused.
- Do not expose internal scores, provider secrets, or restricted source content.
- Return no explanation rather than an unsupported one.
- Cache explanations only when query and supporting facts are stable and cache policy permits it.

An explanation can be generated synchronously only if latency remains acceptable; otherwise it should be an optional asynchronous enhancement.

---

## 13. AI Enrichment Controls

AI may enrich a record with classification, attributes, summaries, or ontology tags. Every AI-generated field must include:

- Provider and model identifier.
- Prompt or pipeline version identifier.
- Creation time.
- Confidence or validation status where meaningful.
- The source facts or derived document used as input.

AI output must be schema validated and either reviewed, confidence-gated, or treated as a soft ranking signal. It must not overwrite source-provided facts such as address, opening hours, phone number, price, or rating without a documented verification process.

---

## 14. Evaluation and Monitoring

Recommendation quality must be measured continuously.

| Area                 | Example metrics                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Retrieval            | Recall@K, candidate coverage, zero-result rate.                    |
| Ranking              | NDCG@K, MRR, click-through rate, save rate, dismissal rate.        |
| Search quality       | Query reformulation rate, filter use, result abandonment.          |
| Geographic relevance | Distance distribution and location-filter compliance.              |
| AI interpretation    | Schema validity, supported-filter precision, fallback rate.        |
| Explanations         | Latency, unsupported-claim reports, user helpfulness feedback.     |
| Cost and reliability | Tokens, embedding cost, model latency, error rate, cache hit rate. |

Offline evaluation uses curated query-to-relevant-restaurant judgments. Online experiments must be controlled, reversible, and privacy-aware.

---

## 15. Failure and Fallback Behavior

| Failure                            | Required fallback                                            |
| ---------------------------------- | ------------------------------------------------------------ |
| Embedding unavailable              | Use keyword, structured, and geographic retrieval.           |
| AI query interpretation fails      | Use original query and deterministic filter parsing.         |
| Explanation generation fails       | Return ranked restaurants without explanations.              |
| Vector index delayed               | Use the latest available vector or keyword fallback.         |
| Incomplete restaurant data         | Rank conservatively and omit unsupported explanation claims. |
| No candidates match strict filters | Explain the empty state and suggest relaxed filters.         |

Core restaurant search must remain useful when all AI services are unavailable.

---

## 16. Privacy, Security, and Cost Controls

- Send the minimum query and restaurant evidence required to an AI provider.
- Do not send raw provider payloads, credentials, private reviews, or unnecessary personal data.
- Document provider data-processing terms and region requirements before production use.
- Use rate limits, timeouts, budgets, and queue-based batch processing for enrichment.
- Cache embeddings and carefully cache safe, stable generated explanations.
- Log model/version, latency, and safe aggregate usage metrics without logging sensitive prompt content by default.
- Support provider abstraction so a model can be replaced for cost, privacy, or quality reasons.

---

## 17. Related Documents

- [00-project-overview.md](00-project-overview.md) — Product goals for discovery and recommendations.
- [02-tech-stack.md](02-tech-stack.md) — Gemini, pgvector, PostgreSQL, and queue choices.
- [03-database-design.md](03-database-design.md) — Search documents, embeddings, and user preference data.
- [05-data-pipeline.md](05-data-pipeline.md) — Enrichment and embedding-update lifecycle.
- [06-backend-api-design.md](06-backend-api-design.md) — Search and recommendation API contracts.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Search and recommendation client behavior.
- [10-future-expansion.md](10-future-expansion.md) — Future personalization and AI capabilities.
