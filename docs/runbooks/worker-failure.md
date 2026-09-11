# Worker Failure Runbook

**Trigger**: Worker stopped processing jobs, high job failure rate, worker backlog growing, worker health checks failing

**Prerequisites**:
- Worker monitoring and alerts configured
- Database connectivity verified
- Recent deployment information available

**Estimated duration**: 15-30 minutes for common issues

---

## Symptoms

Common indicators of worker failure or degradation:

- Worker `/internal/health/ready` endpoint failing
- Jobs stuck in "processing" state beyond lease timeout
- Job backlog growing continuously
- High job failure rate in metrics
- No job completion logs in recent time window
- Email/export notifications not being sent

---

## Initial assessment

### 1. Check worker health

```bash
# Check worker health endpoint (internal only)
ssh production-user@production-host
docker compose -f infra/compose/production.yml exec worker curl -f http://localhost:3003/internal/health/ready

# Or check container status
docker compose -f infra/compose/production.yml ps worker
```

**Worker status**:
- Health check: `[pass/fail/unreachable]`
- Container state: `[running/stopped/restarting]`
- Error message: `[description]`

### 2. Check worker logs

```bash
# View recent worker logs
docker compose -f infra/compose/production.yml logs --tail=100 worker

# Look for:
# - Database connection errors
# - Job processing errors
# - Unhandled exceptions
# - Memory/resource errors
# - Graceful shutdown logs (if restarting)
```

**Log evidence**: `[recent error messages or patterns]`

### 3. Check job queue metrics

```bash
# Check worker metrics endpoint or dashboard
# Look for:
# - Job backlog depth
# - Job failure rate
# - Poll frequency
# - Lease acquisition rate
```

**Metrics snapshot**:
- Backlog depth: `[count]`
- Recent failures: `[count/rate]`
- Last successful job: `[timestamp]`
- Worker uptime: `[duration]`

### 4. Verify database connectivity

```bash
# Worker health check includes database connectivity
# If health check failing, test database separately
docker compose -f infra/compose/production.yml exec worker sh -c 'apk add postgresql-client && psql "$DATABASE_URL" -c "SELECT 1;"'
```

**Database connectivity**: `[pass/fail]`

---

## Common causes and resolutions

### Worker container stopped or crashed

**Symptoms**: Container not running, exit code non-zero, restart loop

**Diagnosis**:
```bash
# Check container status and restart count
docker compose -f infra/compose/production.yml ps worker
docker compose -f infra/compose/production.yml logs worker | grep -i "exit\|error\|fatal"

# Check exit code
docker inspect production-worker-1 | grep -A 5 ExitCode
```

**Resolution**:
```bash
# Restart worker container
docker compose -f infra/compose/production.yml restart worker

# If restart loop: Check logs for startup error
# If memory issue: Review resource limits in production.yml
# If database connectivity: Follow postgres-outage.md runbook
```

- [ ] Root cause identified
- [ ] Worker restarted
- [ ] Health check passing
- [ ] Jobs resuming processing

### Database connectivity failure

**Symptoms**: Worker logs show database connection errors, health check fails with database error

**Diagnosis**:
```bash
# Worker health includes database connectivity check
# Review worker logs for connection errors
docker compose -f infra/compose/production.yml logs worker | grep -i "database\|connection"
```

**Resolution**:
```bash
# Follow postgres-outage.md runbook
# After database restored, restart worker
docker compose -f infra/compose/production.yml restart worker
```

- [ ] Database connectivity restored (see postgres-outage.md)
- [ ] Worker restarted
- [ ] Health check passing

### Job processing errors (code bug)

**Symptoms**: Jobs failing consistently, specific job type failing, error logs show unhandled exception

**Diagnosis**:
```bash
# Review worker logs for job processing errors
docker compose -f infra/compose/production.yml logs worker | grep -i "job.*fail\|unhandled\|error"

# Identify failing job type
# Identify error pattern (all jobs vs specific type)
```

**Resolution**:
```bash
# Short-term: If specific job type failing, may need to skip/cancel failing jobs
# Check if recent deployment introduced regression

# Long-term:
# - Identify bug in job processing code
# - Deploy fix through normal release process
# - Add test coverage for failing scenario
```

- [ ] Failing job type identified
- [ ] Bug identified in code
- [ ] Fix developed and tested
- [ ] Hotfix deployed (if critical) or scheduled for next release

### Job stuck in processing state (lease not released)

**Symptoms**: Jobs stuck in "processing" beyond lease timeout, worker not picking up new jobs

**Diagnosis**:
```bash
# Check database for jobs stuck in processing state
ssh production-user@production-host
psql "$DATABASE_URL" -c "
SELECT id, type, status, created_at, started_at, 
       EXTRACT(EPOCH FROM (NOW() - started_at)) as processing_seconds
FROM \"Job\"
WHERE status = 'processing'
AND started_at < NOW() - INTERVAL '10 minutes';
"
```

**Resolution**:
```bash
# If lease expired but job still marked processing:
# - Job may have crashed without releasing lease
# - Worker may have been killed mid-processing

# Reset stuck jobs to pending (careful: may cause duplicate processing)
psql "$DATABASE_URL" -c "
UPDATE \"Job\"
SET status = 'pending', started_at = NULL, attempts = attempts
WHERE status = 'processing'
AND started_at < NOW() - INTERVAL '15 minutes';
"

# Restart worker to pick up reset jobs
docker compose -f infra/compose/production.yml restart worker
```

- [ ] Stuck jobs identified
- [ ] Jobs reset to pending (with caution)
- [ ] Worker restarted
- [ ] Jobs being processed

### Worker concurrency exhausted

**Symptoms**: Backlog growing but worker healthy, all worker threads busy

**Diagnosis**:
```bash
# Check worker configuration for concurrency setting
# Review metrics for concurrent job count
# Assess if job volume exceeds worker capacity
```

**Resolution**:
```bash
# Short-term: Increase worker concurrency in .env.production
# Update WORKER_CONCURRENCY value
docker compose -f infra/compose/production.yml restart worker

# Long-term:
# - Add second worker instance if single worker insufficient
# - Optimize slow job processing
# - Review job scheduling strategy
```

- [ ] Concurrency increased
- [ ] Worker restarted with new concurrency
- [ ] Backlog decreasing

### Job queue backlog from traffic spike

**Symptoms**: Large backlog but worker processing normally, recent traffic spike

**Diagnosis**:
```bash
# Check job creation rate vs processing rate
# Review recent user activity or bulk operations
# Assess if backlog temporary or sustained
```

**Resolution**:
```bash
# If temporary spike: Worker will catch up naturally
# Monitor backlog depth and processing rate
# Estimate time to clear backlog

# If sustained: May need additional worker capacity
# Consider scaling worker concurrency or adding worker instances
```

- [ ] Traffic spike identified
- [ ] Backlog processing rate assessed
- [ ] Estimated time to clear: `[duration]`
- [ ] Scaling decision made if needed

---

## Manual job management

### Cancel specific failing job

**Use with caution**: Only for jobs that cannot be processed and are blocking queue

```bash
# Mark job as failed manually
ssh production-user@production-host
psql "$DATABASE_URL" -c "
UPDATE \"Job\"
SET status = 'failed', completed_at = NOW()
WHERE id = '[job-id]';
"
```

### Requeue failed job for retry

```bash
# Reset job to pending for retry
psql "$DATABASE_URL" -c "
UPDATE \"Job\"
SET status = 'pending', started_at = NULL
WHERE id = '[job-id]'
AND status = 'failed';
"
```

### Clear all failed jobs (emergency only)

**⚠️ WARNING**: This discards all failed jobs. Only use in extreme backlog situation.

```bash
# Archive failed jobs before clearing (optional)
psql "$DATABASE_URL" -c "
CREATE TABLE IF NOT EXISTS \"Job_Archive\" AS TABLE \"Job\" WITH NO DATA;
INSERT INTO \"Job_Archive\" SELECT * FROM \"Job\" WHERE status = 'failed';
"

# Delete failed jobs
psql "$DATABASE_URL" -c "
DELETE FROM \"Job\" WHERE status = 'failed';
"
```

---

## Escalation

### When to escalate

- Worker repeatedly crashing with no obvious cause
- Database connectivity issue (escalate to postgres-outage.md)
- Job processing bug requiring urgent hotfix
- Backlog growing to unacceptable levels (SLA risk)
- Resource exhaustion requiring infrastructure scaling

### Emergency contacts

- **Incident commander**: `[contact]`
- **On-call engineer**: `[contact]`
- **Database administrator**: `[contact if database issue]`

---

## Post-incident actions

### 1. Record incident evidence

- **Incident ID**: `[unique identifier]`
- **Trigger timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Resolution timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Duration**: `[minutes]`
- **Root cause**: `[description]`
- **Jobs affected**: `[count and types]`

### 2. Prevention measures

- [ ] Add monitoring/alerting to detect earlier
- [ ] Review worker concurrency and capacity
- [ ] Add test coverage for failure scenario
- [ ] Review job retry strategy
- [ ] Consider dead-letter queue for permanently failing jobs

### 3. Verify no duplicate processing

```bash
# If jobs were reset from processing to pending, verify no duplicates
# Check application logic for idempotency
# Review affected user accounts for duplicate actions
```

---

## Monitoring and alerts

**Recommended alerts**:
- Worker health check failing
- Job backlog depth > threshold (e.g., 100)
- Job failure rate > threshold (e.g., 10% over 5 minutes)
- No job completions in last 10 minutes (when queue not empty)
- Worker container restart loop

---

## Related runbooks

- `docs/runbooks/postgres-outage.md` - Database connectivity issues
- `docs/runbooks/api-error-spike.md` - Related if API jobs failing
- `docs/runbooks/deploy.md` - Deployment procedure
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last incident**: `[date]`  
**Next review**: `[date]`
