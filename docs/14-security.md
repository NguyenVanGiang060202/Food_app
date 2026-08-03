# Food Discovery Platform - Security

## 1. Purpose

This document defines baseline security and privacy controls for the platform. It complements, but does not replace, a future threat model and incident-response plan.

---

## 2. Security Principles

- Apply least privilege to users, services, databases, queues, and provider credentials.
- Treat all external input and external-source content as untrusted.
- Minimize collected and retained personal data.
- Keep secrets outside source control and logs.
- Enforce authorization on the backend, not only in the UI.
- Make security-relevant actions auditable.
- Design safe failure behavior: reject, redact, or degrade rather than expose data.

---

## 3. Identity and Access

Public discovery endpoints do not require authentication. User-owned operations and all admin routes require authentication.

Initial roles:

| Role          | Permissions                                                          |
| ------------- | -------------------------------------------------------------------- |
| Visitor       | Public search, categories, and restaurant details.                   |
| User          | Visitor permissions plus own profile, preferences, and saved places. |
| Administrator | Controlled source, crawl, pipeline, and curation operations.         |

Authentication design must use short-lived access credentials and a safe refresh/session strategy selected before implementation. Passwords, if supported, must be hashed with a modern adaptive password hash and never logged or returned. For this small portfolio deployment, admin access must use a strong secret, HttpOnly session controls, least privilege and restricted ingress; MFA is a future hardening step before higher-risk or larger-scale production use.

---

## 4. Secrets and Configuration

- Store secrets in environment variables locally and an approved secret manager in deployed environments.
- Commit only `.env.example` files with empty or placeholder values.
- Use separate credentials per environment and service where possible.
- Rotate secrets immediately after confirmed or suspected exposure.
- Never include secrets in client bundles, source code, error messages, fixtures, screenshots, or logs.
- Limit crawler and AI keys to the narrowest available scopes and quotas.

---

## 5. API Security

- Require HTTPS in production and redirect or reject insecure public traffic.
- Validate body, query, path, and header input through DTOs.
- Apply rate limiting by route and identity/IP, with stricter limits for authentication and admin endpoints.
- Set explicit CORS origins; do not use wildcard origins with credentialed requests.
- Use secure response headers appropriate to the deployed frontend and API.
- Return safe error messages; stack traces stay internal.
- Use opaque cursor pagination and bounded filters to prevent unbounded queries.
- Record request IDs and security-relevant request metadata without storing secrets.

---

## 6. Data Protection

- PostgreSQL is the source of truth and must use authenticated, encrypted connections in production.
- Restrict database and Redis network access to application services.
- Encrypt backups and test restoration regularly.
- Classify data as public catalog, operational/source metadata, user data, or secret.
- Do not expose raw provider payloads or restricted review content through public APIs.
- Define retention and deletion behavior before collecting user profiles, location history, or interaction analytics.
- Limit access to operational data and audit administrative changes.

---

## 7. Crawler and Provider Security

- Follow provider terms, legal requirements, robots policies where applicable, and rate limits.
- Do not bypass CAPTCHAs, access controls, paywalls, or restrictions.
- Store provider cookies/session state only when approved, encrypted, and short-lived.
- Isolate provider adapters and use bounded queues, timeouts, and rate limits.
- Sanitize provider HTML/text before storage or display.
- Keep source attribution but retain raw content only when policy permits.

---

## 8. AI Security and Privacy

- Send only the minimum query and canonical evidence needed to an AI provider.
- Never send secrets, raw browser sessions, restricted provider content, or unnecessary personal data.
- Schema-validate all AI outputs and treat them as untrusted input.
- Ground explanations in supplied canonical facts; omit unsupported explanations.
- Record safe model/version/usage metadata, not sensitive prompt contents by default.
- Review provider processing terms, data residency, and retention before production use.

---

## 9. Frontend Security

- Do not ship backend, crawler, database, or AI secrets to the browser.
- Escape untrusted text and avoid unsafe HTML rendering.
- Use secure authentication storage appropriate to the selected session design.
- Client route guards improve UX only; the API enforces permission.
- Request browser location only after user action and do not persist it without defined consent.

---

## 10. Logging, Auditing, and Incidents

Logs must never include passwords, tokens, cookies, API keys, full raw payloads, or sensitive personal data. Logs should include request/crawl/job IDs, safe error categories, and timing.

Audit at minimum: admin sign-in, role changes, provider enable/disable, manual crawl requests, retries, and canonical data curation. Define an incident process before production: contain access, rotate secrets, preserve relevant evidence, assess impact, and notify affected parties when required.

---

## 11. Security Verification

- Run dependency vulnerability checks in CI.
- Test authentication, authorization, validation, rate limits, and CORS behavior.
- Review migrations and queries for access-control and injection risks.
- Scan repositories and build artifacts for accidental secrets.
- Verify reverse-proxy security headers, upstream timeouts, HSTS, and the
  deployment-specific CSP at the HTTPS edge.
- Perform a security review before enabling public accounts, admin access, or production crawlers.

---

## 12. Related Documents

- [06-backend-api-design.md](06-backend-api-design.md) — API protections.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — AI controls.
- [09-development-rules.md](09-development-rules.md) — Secure development rules.
- [16-deployment.md](16-deployment.md) — Production network and secret handling.
