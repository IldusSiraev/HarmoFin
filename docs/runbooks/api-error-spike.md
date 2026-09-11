# API Error Spike Runbook

**Trigger**: Elevated HTTP 5xx error rate, high error rate alert, dashboard showing error spike

**Prerequisites**:
- Baseline error rate known
- Recent deployment information available
- Monitoring and log access configured

**Estimated duration**: 15-60 minutes depending on root cause

---

## Symptoms

Common indicators of API error spike:

- HTTP 5xx error rate significantly above baseline
- Alert triggered for error rate threshold
- Dashboard shows error rate increase
- User reports of application errors or failures
- Increased error reporting backend activity

---

## Initial assessment

### 1. Confirm error spike scope

```bash
# Check API health endpoint
curl -f https://production-domain/api/v1/health/live
curl -f https://production-domain/api/v1/health/ready

# Check metrics dashboard for:
# - Current error rate vs baseline
# - Error rate by endpoint
# - Error rate by status code (500, 502, 503, 504)
```

**Error rate snapshot**:
- Baseline error rate: `[percentage or count/min]`
- Current error rate: `[percentage or count/min]`
- Duration: `[minutes since spike started]`
- Affected endpoints: `[all | specific routes]`
- Status code distribution: `[500: X%, 502: Y%, etc.]`

### 2. Check recent deployments

```bash
# Check if error spike correlates with recent deployment
# Review GitHub Actions for recent production deploys
# Check metrics for release SHA

# If recent deployment: Likely regression in new code
# If no recent deployment: Environmental or load-related issue
```

**Recent deployment**:
- Last deployment: `[timestamp]`
- Deployment SHA: `[commit SHA]`
- Error spike timing: `[before/after/unrelated to deployment]`

### 3. Review error logs

```bash
# Query log backend for recent 5xx errors
# Look for:
# - Common error message or stack trace
# - Specific endpoint failing
# - Database connection errors
# - External service failures
# - Unhandled exceptions

# Example log query (adjust for your log backend):
# - status:5xx AND level:error in last 15 minutes
# - Group by error message
# - Identify most frequent error
```

**Log evidence**:
- Most common error: `[error message or exception]`
- Affected endpoint(s): `[route paths]`
- Error frequency: `[count]`

### 4. Check service health

```bash
# Check API container status
ssh production-user@production-host
docker compose -f infra/compose/production.yml ps api
docker compose -f infra/compose/production.yml logs --tail=50 api
```

**Service status**:
- Container state: `[running/restarting/stopped]`
- Recent container restarts: `[count]`
- Resource usage: `[CPU/memory if visible]`

---

## Common causes and resolutions

### Deployment regression (code bug)

**Symptoms**: Error spike immediately after deployment, specific error pattern in logs

**Diagnosis**:
```bash
# Review deployment timing vs error spike
# Identify new code introduced in deployment
# Review error logs for new exception types
git log --oneline $PREVIOUS_SHA..$CURRENT_SHA
```

**Resolution**:
```bash
# Rollback to previous known-good SHA
# Follow image-rollback.md runbook

# Prerequisites for rollback:
# - Migration compatibility: backward-compatible or rollback-safe
# - Previous SHA identified and verified
```

- [ ] Deployment regression confirmed
- [ ] Rollback decision made
- [ ] Follow docs/runbooks/image-rollback.md
- [ ] Services restored with previous SHA
- [ ] Error rate returned to baseline

### Database connectivity failure

**Symptoms**: 500 errors with database connection errors in logs, health ready endpoint failing

**Diagnosis**:
```bash
# Check API health ready endpoint (includes database check)
curl -f https://production-domain/api/v1/health/ready

# Review logs for database connection errors
docker compose -f infra/compose/production.yml logs api | grep -i "database\|connection"
```

**Resolution**:
```bash
# Follow postgres-outage.md runbook
# After database restored, verify API recovers
curl -f https://production-domain/api/v1/health/ready
```

- [ ] Database issue confirmed
- [ ] Follow docs/runbooks/postgres-outage.md
- [ ] Database connectivity restored
- [ ] API error rate returned to baseline

### External service failure (SMTP, observability)

**Symptoms**: Specific endpoint failing (password reset, notifications), external service timeout errors

**Diagnosis**:
```bash
# Review logs for external service errors
# - SMTP connection errors
# - Error reporting endpoint unreachable
# - Tracing backend timeout

# Check if external service is degraded
# - SMTP provider status page
# - Observability provider status page
```

**Resolution**:
```bash
# If external service degraded:
# - Wait for external service recovery
# - Monitor external service status page
# - Consider temporary feature disable if critical

# If misconfiguration:
# - Verify external service credentials
# - Check network connectivity from API container
# - Follow secret-rotation.md if credentials rotated without updating API
```

- [ ] External service failure identified
- [ ] Service provider status checked
- [ ] Mitigation applied (wait/disable/fix configuration)
- [ ] API error rate improved or isolated to specific feature

### Traffic spike or resource exhaustion

**Symptoms**: Gradual error rate increase, timeouts, memory/CPU exhaustion, no code changes

**Diagnosis**:
```bash
# Check API request rate vs baseline
# Check container resource usage
docker stats production-api-1

# Check for unusual traffic patterns
# - Single user making many requests
# - DDoS or bot traffic
# - Legitimate traffic spike (viral post, scheduled event)
```

**Resolution**:
```bash
# Short-term:
# - Rate limit aggressive clients if identifiable
# - Scale API container resources if provider allows
# - Add additional API replica if supported

# Immediate relief:
# - Restart API to clear memory if memory leak suspected
docker compose -f infra/compose/production.yml restart api

# Long-term:
# - Optimize slow endpoints
# - Add caching layer
# - Review rate limiting strategy
# - Scale infrastructure
```

- [ ] Traffic spike or resource exhaustion confirmed
- [ ] Immediate mitigation applied
- [ ] Error rate improved
- [ ] Capacity planning review scheduled

### Specific endpoint bug (not deployment-wide)

**Symptoms**: Single endpoint or feature failing, other endpoints healthy

**Diagnosis**:
```bash
# Identify failing endpoint from logs/metrics
# Check if specific query parameter or input triggers error
# Review recent changes to that endpoint
```

**Resolution**:
```bash
# If non-critical endpoint:
# - Document known issue
# - Schedule fix for next release
# - Communicate to users if needed

# If critical endpoint:
# - Develop hotfix
# - Test in staging
# - Deploy via normal release process
# - OR temporarily disable endpoint if possible
```

- [ ] Failing endpoint identified
- [ ] Impact assessed (critical vs non-critical)
- [ ] Mitigation plan (hotfix vs scheduled fix vs disable)
- [ ] User communication if needed

### Unhandled exception in new code path

**Symptoms**: New exception type in logs, specific user action triggers error

**Diagnosis**:
```bash
# Review error logs for stack trace
# Identify code path causing exception
# Reproduce in staging if possible
```

**Resolution**:
```bash
# Follow deployment regression resolution (rollback or hotfix)
# Add test coverage for failing scenario
# Deploy fix through normal release process
```

- [ ] Exception root cause identified
- [ ] Rollback or hotfix decision made
- [ ] Test coverage added
- [ ] Fix deployed

---

## Temporary mitigation strategies

### Restart API to clear transient state

**Use when**: Memory leak suspected, connection pool exhausted, transient error

```bash
ssh production-user@production-host
docker compose -f infra/compose/production.yml restart api
```

**Impact**: In-flight requests interrupted, brief service disruption (10-30 seconds)

### Disable problematic feature flag (if feature flagged)

**Use when**: New feature causing errors, feature can be safely disabled

```bash
# If feature flags implemented via environment variable
# Update .env.production to disable feature
# Restart API
docker compose -f infra/compose/production.yml restart api
```

### Increase API resources (if provider supports)

**Use when**: Resource exhaustion confirmed, scaling possible

```bash
# Scale via provider console or update production.yml resource limits
# Redeploy with increased resources
```

---

## Escalation

### When to escalate

- Error rate remains high after initial mitigation attempts
- Database or infrastructure issue requiring specialist (escalate to postgres-outage.md)
- Code bug requiring urgent hotfix beyond on-call engineer capability
- User data integrity concern
- Sustained high error rate risking SLA breach

### Emergency contacts

- **Incident commander**: `[contact]`
- **On-call engineer**: `[contact]`
- **Database administrator**: `[contact if database issue]`
- **API/backend team lead**: `[contact for code issues]`

---

## Communication

### User communication

**If user-facing impact**:
- [ ] Status page updated (if exists)
- [ ] User-facing communication drafted
- [ ] Support team notified
- [ ] Timeline for resolution communicated

**Communication template**:
```
We are investigating elevated error rates affecting [feature/all functionality].
[Specific actions users should avoid or expect delays]
We will provide updates every [timeframe].
```

---

## Post-incident actions

### 1. Record incident evidence

- **Incident ID**: `[unique identifier]`
- **Trigger timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Resolution timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Duration**: `[minutes]`
- **Peak error rate**: `[percentage or count/min]`
- **Root cause**: `[description]`
- **User impact**: `[number of affected requests/users]`

### 2. Root cause analysis

- [ ] Root cause identified and documented
- [ ] Timeline of events recorded
- [ ] Contributing factors identified
- [ ] Detection delay analyzed (could we have caught it earlier?)

### 3. Prevention measures

- [ ] Add test coverage for failure scenario
- [ ] Add monitoring/alerting to detect earlier
- [ ] Code fix deployed (if bug)
- [ ] Deployment process improvement (if regression)
- [ ] Update this runbook with lessons learned

### 4. Post-incident review

- [ ] Post-incident review scheduled
- [ ] Action items assigned
- [ ] SLA impact assessed
- [ ] User communication follow-up

---

## Monitoring and alerts

**Recommended alerts**:
- HTTP 5xx error rate > baseline threshold (e.g., 1% over 5 minutes)
- API health ready endpoint failing
- Specific endpoint error rate > threshold
- Response time P99 > threshold
- Container restart loop

**Recommended dashboard panels**:
- HTTP status code distribution over time
- Error rate by endpoint
- Response time percentiles (P50, P95, P99)
- Request rate
- Container resource usage
- Release SHA and deployment markers

---

## Related runbooks

- `docs/runbooks/deploy.md` - Production deployment procedure
- `docs/runbooks/image-rollback.md` - Application rollback procedure
- `docs/runbooks/postgres-outage.md` - Database connectivity issues
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last incident**: `[date]`  
**Next review**: `[date]`
