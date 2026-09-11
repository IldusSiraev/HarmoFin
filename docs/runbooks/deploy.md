# Production Deployment Runbook

**Trigger**: Approved production release with all evidence gates passed

**Prerequisites**:
- Release checklist completed (`docs/operations/release-record.md`)
- Staging deployment successful with same SHA
- Migration compatibility verified
- Backup evidence current
- On-call engineer available

**Estimated duration**: 30-60 minutes including observation window

---

## Pre-deployment

### 1. Verify prerequisites

```bash
# Check release checklist completion
# Verify staging workflow run succeeded
# Confirm backup within RPO window (≤1 hour)
# Confirm migration compatibility classification
```

- [ ] Release SHA published and scanned
- [ ] Staging smoke tests passed with this SHA
- [ ] Backup evidence current (≤1 hour old)
- [ ] Migration compatibility: `[forward-only | backward-compatible | rollback-safe]`
- [ ] On-call engineer notified and available
- [ ] Rollback SHA identified: `[previous known-good SHA]`

### 2. Record production baseline

```bash
# Access production dashboard
# Record current metrics before deployment:
# - HTTP error rate
# - API P95/P99 latency
# - Active user sessions
# - Worker backlog depth
# - Database connection count
```

**Baseline snapshot**: `[dashboard URL or screenshot reference]`

### 3. Trigger production backup

```bash
# Trigger manual backup before deployment via provider console
# Wait for backup confirmation
# Record backup reference
```

**Pre-deployment backup**: `[protected backup reference]`

---

## Deployment execution

### 4. Invoke production workflow

Navigate to: `.github/workflows/deploy-production.yml`

**Workflow inputs**:
- `image_tag`: `[exact commit SHA]`
- `staging_evidence`: `[staging workflow run URL]`
- `migration_compatibility`: `[forward-only | backward-compatible | rollback-safe]`
- `backup_evidence`: `[backup reference from step 3]`

**GitHub Environment approval**: Requires `production` environment approver confirmation

### 5. Monitor deployment progress

```bash
# Watch GitHub Actions workflow run
# Monitor each deployment phase:
# - Input validation
# - SSH connection
# - File upload
# - Migration execution
# - Service reconciliation
# - Health checks
# - Smoke tests
```

**Workflow run**: `[GitHub Actions URL]`

**Expected phases**:
1. Validate inputs ✓
2. Configure SSH ✓
3. Upload deployment files ✓
4. Upload production environment file ✓
5. Deploy exact SHA (migration → rollout → health → smoke) ✓
6. Publish release metadata ✓

---

## Post-deployment verification

### 6. Verify service health

```bash
# Check all service health probes
curl -f https://production-domain/
curl -f https://production-domain/api/v1/health/live
curl -f https://production-domain/api/v1/health/ready

# Verify worker health (internal only, via SSH if needed)
# curl http://worker:3003/internal/health/live
# curl http://worker:3003/internal/health/ready
```

- [ ] Web responds with 200
- [ ] API live probe responds with 200
- [ ] API ready probe responds with 200
- [ ] Worker live probe responds with 200
- [ ] Worker ready probe responds with 200

### 7. Verify database connectivity

```bash
# API ready probe includes database check
# Verify recent operations visible in production
# No connection pool exhaustion
```

- [ ] Database connections healthy
- [ ] Recent operations queryable
- [ ] No connection errors in logs

### 8. Test critical authenticated journey

**Critical path**: Sign in → view budget → view journal → verify recent operation

- [ ] Sign-in flow works
- [ ] Session created and persisted
- [ ] Budget list loads
- [ ] Journal query returns results
- [ ] No authentication errors

**Test account**: `[designated test account for production smoke - not in Git]`

### 9. Verify observability

```bash
# Check logs appearing in log backend
# Check metrics updating in dashboard
# Check traces appearing (if configured)
# Check error reporting connected (if configured)
```

- [ ] Request logs appearing with request IDs
- [ ] Metrics updating (HTTP requests, database, worker)
- [ ] Release SHA visible in metrics
- [ ] Traces appearing (if configured)
- [ ] Error reporting connected (if configured)
- [ ] No sensitive data in logs

### 10. Monitor for error rate spike

**Observation window**: 30 minutes minimum

```bash
# Monitor production dashboard for:
# - HTTP 5xx error rate increase
# - API latency P95/P99 degradation
# - Database connection failures
# - Worker job failure rate increase
# - User-reported issues
```

**Metrics to watch**:
- HTTP error rate: `[baseline]` → `[current]`
- API P95 latency: `[baseline]` → `[current]`
- Worker backlog: `[baseline]` → `[current]`

- [ ] Error rate within baseline range
- [ ] Latency within baseline range
- [ ] No worker backlog spike
- [ ] No user-reported issues

---

## Rollback (if needed)

**Trigger**: Critical error rate spike, data corruption, or service unavailability

### Rollback decision gate

**Do not rollback without**:
1. Confirming migration compatibility permits rollback
2. Recording rollback reason and evidence
3. Approval from on-call engineer and release owner

**Migration compatibility check**:
- `forward-only`: Rollback NOT SAFE (database schema incompatible with previous code)
- `backward-compatible`: Rollback SAFE (previous code can run with new schema)
- `rollback-safe`: Rollback SAFE with explicit verification

### Rollback execution

See: `docs/runbooks/image-rollback.md`

```bash
# Invoke production deployment workflow with previous known-good SHA
# Workflow inputs:
# - image_tag: [rollback SHA]
# - staging_evidence: [original staging evidence]
# - migration_compatibility: backward-compatible
# - backup_evidence: [current backup]
```

**Rollback SHA**: `[from release checklist step 1]`

**Post-rollback**:
- [ ] Services healthy with rollback SHA
- [ ] Error rate returned to baseline
- [ ] Critical journey verified
- [ ] Incident record created

---

## Completion

### 11. Record release evidence

Update `docs/operations/release-record.md` with:
- Production workflow run URL
- Post-deployment verification results
- Observation window completion timestamp
- Approvals from on-call engineer and release owner

### 12. Publish release communication

- [ ] Notify team of successful deployment
- [ ] Update release tracking system
- [ ] Schedule post-release review if issues encountered

---

## Emergency contacts

- **On-call engineer**: `[contact from release checklist]`
- **Release owner**: `[contact from release checklist]`
- **Database administrator**: `[contact]`
- **Provider support**: `[support contact for infrastructure provider]`

---

## Related runbooks

- `docs/runbooks/image-rollback.md` - Application rollback procedure
- `docs/runbooks/database-restore.md` - Database recovery procedure
- `docs/runbooks/api-error-spike.md` - Elevated error investigation
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last tested**: `[date]`  
**Next review**: `[date]`
