# Food Discovery Platform - Deployment

## 1. Purpose

This document defines the deployment model for local development and a small
public portfolio deployment. Docker containers provide a consistent unit of
deployment; Docker Compose is the baseline for local development and the first
production deployment for a service expected to support fewer than 500 users.
Enterprise staging, multi-region availability and zero-downtime rollout are
future options, not release requirements.

---

## 2. Runtime Services

```text
Internet
  ↓ HTTPS
Reverse proxy
  ├── Frontend web server
  ├── Backend API
  ├── One-shot crawler worker (manual/cron)
  ├── PostgreSQL + PostGIS + pgvector
  └── Redis
```

Workers do not receive public traffic. PostgreSQL and Redis are private services and are not exposed publicly.

---

## 3. Environments

| Environment | Purpose                           | Rules                                                                       |
| ----------- | --------------------------------- | --------------------------------------------------------------------------- |
| Local       | Development and fast iteration.   | Docker Compose; non-production secrets and bounded fixtures.                |
| Portfolio   | Public demo and small real usage. | HTTPS, private data services, strong secrets, healthchecks, manual backups. |

Local and portfolio deployments must use separate configuration, database
credentials and persistent volumes. A dedicated staging environment is optional.

---

## 4. Container Requirements

- Build versioned images for frontend and backend; the crawler may run as a
  one-shot worker from the same release source.
- The repository includes a production frontend image at `frontend/Dockerfile`;
  it serves the Vite build, provides SPA fallback, and proxies `/api/` to the
  backend service. Enable it with the Compose `production` profile.
- Run containers as non-root users where practical.
- Use explicit health checks and restart policies.
- Pass configuration via environment variables or secret mounts, never baked into images.
- Keep images small and patch dependencies regularly.
- Use separate processes/containers for API and long-running workers.

---

## 5. Deployment Process

1. Run CI quality gates and build the release images.
2. Back up the portfolio PostgreSQL volume or database before schema changes.
3. Pull/build the selected release on the VPS or Docker host.
4. Run migrations once through the documented migration command.
5. Restart frontend/backend and run health, API and critical-flow smoke checks.
6. Run the bounded crawler manually or from a low-frequency cron when needed.
7. Keep the previous image/tag available for a manual application rollback.

Database migrations should be backward-compatible where practical. Since the
portfolio deployment uses one small host rather than rolling instances, a short
maintenance window is acceptable for a migration.

---

## 6. Rollback

- Roll back application containers to the previous known-good image when a release fails.
- Do not automatically reverse destructive database migrations.
- Use expand/migrate/contract schema patterns for changes requiring rollback safety.
- Keep a documented manual restore procedure for database corruption or
  irreversible migration failure; scheduled restore rehearsals are optional
  until the project has meaningful user data.
- Pause crawlers or workers when they are causing unsafe repeated processing.

---

## 7. Reverse Proxy and Network

The reverse proxy terminates TLS, redirects HTTP to HTTPS, serves frontend assets, and forwards only approved API routes. Configure explicit CORS origins, request-size limits, rate limiting, and secure headers. The bundled frontend Nginx configuration adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`; it also bounds API upstream connect, read, and send timeouts. Add HSTS and a deployment-specific CSP only at an HTTPS-aware edge after validating OAuth, map tiles, and API assets.

Only the reverse proxy has public ingress. Internal services communicate on private container or network segments. Admin interfaces should be separately protected by authentication and, where possible, network restrictions.

---

## 8. Data Protection and Backups

- Create a manual PostgreSQL backup before migrations and important releases.
- Store at least one recent backup outside the application container.
- Test restoration into a temporary database at least once before the public demo.
- Automated encrypted backups and scheduled restore rehearsals are P2 work.
- Define whether Redis is ephemeral cache/queue state or needs persistence for the selected job model.
- Store backups outside the primary host when production impact justifies it.
- Protect database credentials, backups, and logs according to [14-security.md](14-security.md).

---

## 9. Monitoring

For the portfolio deployment, monitor at minimum:

- API availability, errors, and latency.
- Database health, storage, connections, and slow queries.
- Redis health and container restarts.
- Crawler success/failure and last successful run.
- Host/container CPU, memory and disk usage.

An uptime check and a short restart/logging runbook are sufficient initially.
Metrics dashboards, distributed tracing and alert routing are optional P2 work.

---

## 10. Release Checklist

- [ ] CI passed and images are versioned.
- [ ] Clean database image initialization and required schema checks passed.
- [ ] Production frontend image builds with the release tag and `nginx -t` passes.
- [ ] Environment configuration and secrets are present.
- [ ] Migration plan and backup are verified.
- [ ] Health/readiness checks pass.
- [ ] Public API and frontend smoke tests pass.
- [ ] Workers process a safe bounded test job.
- [ ] Uptime check or equivalent availability check is active.
- [ ] Logs/restart instructions and a manual rollback target are known.

---

## 11. Related Documents

- [02-tech-stack.md](02-tech-stack.md) — Docker, Redis, PostgreSQL, and CI choices.
- [14-security.md](14-security.md) — Network, secrets, and backup controls.
- [17-environment-setup.md](17-environment-setup.md) — Local environment setup.
- [15-testing-strategy.md](15-testing-strategy.md) — Release verification.
