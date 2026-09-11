# Image Rollback Runbook

**Trigger**: Production deployment failure or critical issue requiring immediate return to previous known-good state

**Prerequisites**:
- Migration compatibility verified as `backward-compatible` or `rollback-safe`
- Previous SHA identified and verified in staging
- Incident owner assigned

**Estimated duration**: 15-30 minutes

---

## Rollback decision gate

**STOP**: Do not proceed without verifying migration compatibility

### Migration compatibility check

Review the production release record for this deployment's migration compatibility:

- **forward-only**: ❌ Rollback NOT SAFE
  - New database schema incompatible with previous application code
  - Database restore is the only recovery path (see `docs/runbooks/database-restore.md`)
  - Do not attempt image rollback

- **backward-compatible**: ✅ Rollback SAFE
  - Previous application code can run with new database schema
  - Proceed with image rollback

- **rollback-safe**: ✅ Rollback SAFE with verification
  - Explicit testing confirmed rollback compatibility
  - Verify rollback SHA in release record
  - Proceed with image rollback

**Current migration compatibility**: `[from release record]`

- [ ] Migration compatibility permits image rollback
- [ ] Rollback SHA identified: `[previous known-good SHA]`
- [ ] Incident owner assigned: `[name]`

---

## Pre-rollback

### 1. Record incident context

```bash
# Capture evidence before rollback:
# - Current error rate and metrics
# - Recent log entries showing failure
# - User impact assessment
# - Triggering event or alert
```

**Incident ID**: `[unique identifier]`  
**Trigger**: `[error spike | service unavailable | data corruption | other]`  
**User impact**: `[description]`  
**Evidence**: `[dashboard URLs, log queries, alert references]`

### 2. Verify rollback SHA availability

```bash
# Confirm rollback SHA exists in registry
docker manifest inspect ghcr.io/[org]/[repo]/web:$ROLLBACK_SHA
docker manifest inspect ghcr.io/[org]/[repo]/api:$ROLLBACK_SHA
docker manifest inspect ghcr.io/[org]/[repo]/worker:$ROLLBACK_SHA
```

**Rollback SHA**: `[commit SHA]`

- [ ] Rollback SHA images exist in registry
- [ ] Rollback SHA previously verified in staging

### 3. Notify stakeholders

- [ ] On-call engineer notified
- [ ] Release owner notified
- [ ] Team channel updated with rollback intent

---

## Rollback execution

### 4. Invoke production deployment workflow with rollback SHA

Navigate to: `.github/workflows/deploy-production.yml`

**Workflow dispatch inputs**:
- `image_tag`: `[rollback SHA]`
- `staging_evidence`: `[original staging evidence for rollback SHA]`
- `migration_compatibility`: `backward-compatible` or `rollback-safe`
- `backup_evidence`: `[current backup reference]`

**GitHub Environment approval**: Requires `production` environment approver

**Note**: This is NOT a new migration. The migration step will be idempotent (already applied).

### 5. Monitor rollback deployment

```bash
# Watch GitHub Actions workflow run
# Monitor service reconciliation
# Watch for health check success
```

**Rollback workflow run**: `[GitHub Actions URL]`

**Expected behavior**:
1. Validate inputs ✓
2. Pull rollback SHA images ✓
3. Migration step (idempotent, already applied) ✓
4. Service reconciliation to rollback images ✓
5. Health checks pass ✓
6. Smoke tests pass ✓

---

## Post-rollback verification

### 6. Verify services healthy with rollback SHA

```bash
curl -f https://production-domain/
curl -f https://production-domain/api/v1/health/live
curl -f https://production-domain/api/v1/health/ready
```

- [ ] Web responds with 200
- [ ] API health probes respond with 200
- [ ] Worker health probes respond with 200

### 7. Verify error rate returned to baseline

```bash
# Check production dashboard
# Compare current metrics to pre-deployment baseline
```

**Error rate**: `[baseline]` → `[current after rollback]`  
**API latency P95**: `[baseline]` → `[current after rollback]`

- [ ] Error rate returned to acceptable range
- [ ] Latency returned to baseline
- [ ] No worker backlog

### 8. Test critical authenticated journey

- [ ] Sign-in works
- [ ] Budget list loads
- [ ] Journal query works
- [ ] No authentication errors

### 9. Verify metrics show rollback SHA

```bash
# Check metrics endpoint or dashboard
# Confirm release SHA label shows rollback SHA
```

- [ ] Metrics show rollback SHA
- [ ] Logs include rollback SHA

---

## Post-rollback actions

### 10. Update incident record

```bash
# Document rollback completion
# Record rollback SHA, timing, and verification results
```

**Rollback completed**: `[timestamp]`  
**Rollback duration**: `[minutes]`  
**Services restored**: `[yes/no]`

### 11. Investigate root cause

**Do not re-deploy without**:
1. Root cause identified
2. Fix verified in staging
3. Post-incident review completed

**Investigation tasks**:
- [ ] Root cause identified
- [ ] Fix developed and tested
- [ ] Staging verification with fix
- [ ] Post-incident review scheduled

### 12. Notify stakeholders of completion

- [ ] Team notified of rollback completion
- [ ] User communication (if user-facing impact)
- [ ] Incident tracking system updated

---

## If rollback fails

**Escalation trigger**: Rollback does not restore service health

### Escalate to database restore

If image rollback does not resolve the issue:
1. Assess whether database corruption or data issue is root cause
2. Follow `docs/runbooks/database-restore.md`
3. Escalate to incident commander and DBA

### Emergency contacts

- **Incident commander**: `[contact]`
- **Database administrator**: `[contact]`
- **Provider support**: `[support contact]`

---

## Prevention

**Post-incident actions to prevent recurrence**:
- [ ] Add monitoring/alerting for this failure mode
- [ ] Add CI gate to catch this class of issue
- [ ] Update deployment checklist with additional verification
- [ ] Document lessons learned in post-incident review

---

## Related runbooks

- `docs/runbooks/deploy.md` - Production deployment procedure
- `docs/runbooks/database-restore.md` - Database recovery procedure
- `docs/runbooks/api-error-spike.md` - Elevated error investigation
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last tested**: `[date]`  
**Next review**: `[date]`
