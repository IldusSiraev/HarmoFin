# Production Release Checklist

This document serves as the gate before production deployment. Complete all sections and record evidence before invoking the production deployment workflow.

## Release metadata

- **Release SHA**: `[commit SHA]`
- **Release owner**: `[name and contact]`
- **Release date/time**: `[YYYY-MM-DD HH:MM UTC]`
- **Observation window end**: `[YYYY-MM-DD HH:MM UTC]`

## Pre-deployment verification

### 1. Staging evidence

- [ ] Staging deployed this exact SHA successfully
- [ ] Staging workflow run URL: `[GitHub Actions URL]`
- [ ] Staging smoke tests passed
- [ ] Staging critical authenticated journey verified
- [ ] Staging observability confirmed (logs/metrics/traces/errors delivered)

### 2. Migration compatibility

- [ ] Migration compatibility classification: `[forward-only | backward-compatible | rollback-safe]`
- [ ] Migration impact assessed (schema changes, data migration, duration estimate)
- [ ] Rollback decision documented with reasoning

**Migration notes:**

```
[Describe migration changes, compatibility constraints, and rollback approach]
```

### 3. Backup and restore evidence

- [ ] Current production backup verified within RPO window (≤1 hour)
- [ ] Recent restore drill evidence: `[reference to restore drill record]`
- [ ] Restore drill RTO: `[measured time]`
- [ ] Backup reference: `[protected backup identifier - do not commit to Git]`

### 4. Security and compliance

- [ ] No new high/critical security findings in CI scans
- [ ] OpenAPI contract compatibility verified (no breaking changes)
- [ ] Security review completed for this release
- [ ] No committed secrets, credentials or customer data

### 5. Operational readiness

- [ ] Alert routing and escalation owners confirmed
- [ ] Runbooks reviewed and available
- [ ] Rollback image SHA identified: `[SHA of previous known-good release]`
- [ ] On-call engineer notified and available
- [ ] Communication plan for user-facing issues prepared

### 6. CI quality gates

- [ ] All PR checks passed
- [ ] Production images built and published with this SHA
- [ ] SBOM and dependency scans completed
- [ ] Image scans passed or exceptions documented
- [ ] Browser tests passed

## Deployment execution

### Pre-deployment

- [ ] Production baseline metrics recorded (error rate, latency, availability)
- [ ] Production backup triggered and verified before deployment

### Deployment

- [ ] Production workflow invoked with required inputs
- [ ] Migration completed successfully
- [ ] Services rolled out and became healthy
- [ ] Post-deployment smoke tests passed

### Post-deployment verification

- [ ] All health probes responding (web, API, worker)
- [ ] Database connectivity verified
- [ ] Worker started and processing jobs
- [ ] Logs/metrics/traces/errors appearing in backends
- [ ] Critical user journey tested in production
- [ ] No error rate spike observed
- [ ] Latency within baseline range

## Evidence artifacts

- Staging workflow run: `[URL]`
- Production workflow run: `[URL]`
- Release metadata artifact: `[artifact reference]`
- Migration compatibility: `[forward-only | backward-compatible | rollback-safe]`
- Backup evidence: `[protected reference]`
- Post-deployment metrics snapshot: `[dashboard URL or screenshot reference]`

## Approval

| Role             | Name | Approval   | Timestamp |
| ---------------- | ---- | ---------- | --------- |
| Release owner    |      | ☐ Approved |           |
| On-call engineer |      | ☐ Approved |           |
| Technical lead   |      | ☐ Approved |           |

## Rollback decision

If rollback is required during observation window:

- [ ] Rollback to SHA: `[previous SHA]`
- [ ] Migration compatibility permits rollback: `[yes/no]`
- [ ] Rollback runbook: `docs/runbooks/image-rollback.md`

**Do not rollback without:**

1. Confirming migration compatibility
2. Recording rollback reason and evidence
3. Preserving logs and metrics for post-incident analysis

## Notes

```
[Additional context, special considerations, known issues, or observations]
```

---

**Template version**: 2026-09-09  
**Protected evidence location**: `[secure operations record system - not Git]`
