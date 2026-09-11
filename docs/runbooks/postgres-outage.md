# PostgreSQL Outage Runbook

**Trigger**: Database connectivity failure, high error rate from database queries, health checks failing with database errors

**Prerequisites**:

- Database monitoring and alerts configured
- Provider support contact information available
- Recent backup evidence current

**Estimated duration**: 15 minutes - 4 hours depending on root cause

---

## Symptoms

Common indicators of PostgreSQL outage or degradation:

- API `/health/ready` endpoint failing with database error
- Worker `/internal/health/ready` failing with database check error
- High rate of database connection errors in logs
- Database connection pool exhaustion
- Query timeouts or extremely high latency
- Provider alert indicating database instance unhealthy

---

## Initial assessment

### 1. Confirm database outage scope

```bash
# Check API health (includes database check)
curl -f https://production-domain/api/v1/health/ready

# Check worker health (includes database check)
# SSH to production host if worker health not externally accessible
ssh production-user@production-host
docker compose -f infra/compose/production.yml exec worker curl -f http://localhost:3003/internal/health/ready
```

**Health check results**:

- API ready: `[pass/fail]`
- Worker ready: `[pass/fail]`
- Error message: `[database error details]`

### 2. Test direct database connectivity

```bash
# Test database connection from application host
# DO NOT include actual DATABASE_URL in Git
ssh production-user@production-host
psql "$DATABASE_URL" -c "SELECT 1;"
```

**Connectivity test results**:

- [ ] Connection succeeds
- [ ] Connection times out
- [ ] Connection refused
- [ ] Authentication failure
- [ ] Other error: `[description]`

### 3. Check provider database console

```bash
# Navigate to provider database console
# Check instance status, metrics, alerts
```

**Provider status**:

- Instance state: `[available/stopped/maintenance/failing-over/unknown]`
- CPU usage: `[percentage]`
- Memory usage: `[percentage]`
- Connection count: `[current/max]`
- IOPS: `[current]`
- Recent alerts: `[description]`

### 4. Review application logs

```bash
# Check recent API/worker logs for database errors
# Look for connection pool exhaustion, query timeouts, connection refused

# Example log queries (adjust for your log backend):
# - "database connection" AND "error" in last 15 minutes
# - "connection pool" AND "exhausted" in last 15 minutes
# - "query timeout" in last 15 minutes
```

**Log evidence**: `[log query results or dashboard URL]`

---

## Common causes and resolutions

### Connection pool exhaustion

**Symptoms**: "connection pool exhausted", "too many clients", API/worker can't acquire connection

**Diagnosis**:

```bash
# Check active connection count vs pool size
# Review DATABASE_URL connection pool settings
# Check for long-running queries or transactions
```

**Resolution**:

```bash
# Short-term: Restart API/worker to reset connection pools
docker compose -f infra/compose/production.yml restart api worker

# Long-term:
# - Increase connection pool size if database can handle it
# - Investigate connection leaks in application code
# - Add connection pool monitoring/alerts
```

- [ ] Connection pool settings reviewed
- [ ] Services restarted
- [ ] Health checks passing
- [ ] Connection monitoring added

### Database instance failure or maintenance

**Symptoms**: Connection refused, provider console shows instance stopped/maintenance/failing-over

**Diagnosis**:

```bash
# Check provider console for:
# - Scheduled maintenance window
# - Automatic failover in progress
# - Instance stopped/terminated
# - Provider-wide outage
```

**Resolution**:

```bash
# If scheduled maintenance: Wait for maintenance completion (typically 15-30 min)
# If automatic failover: Wait for failover completion (typically 1-5 min)
# If instance stopped: Restart via provider console
# If provider outage: Escalate to provider support

# Monitor provider console for instance to return to available state
# Verify health checks pass after instance recovers
```

- [ ] Root cause identified
- [ ] Instance recovered or failover completed
- [ ] Health checks passing
- [ ] Provider support ticket opened (if needed)

### Network connectivity failure

**Symptoms**: Connection timeout, network unreachable, DNS resolution failure

**Diagnosis**:

```bash
# Test network connectivity from application host
ssh production-user@production-host
ping database-hostname
nslookup database-hostname
telnet database-hostname 5432
```

**Resolution**:

```bash
# Check firewall/security group rules
# Check private network configuration
# Check DNS resolution
# Verify database hostname hasn't changed (provider failover)

# If network rules changed: Restore application host access
# If DNS issue: Verify DATABASE_URL hostname correct
# If provider network issue: Escalate to provider support
```

- [ ] Network connectivity restored
- [ ] Firewall rules verified
- [ ] DNS resolution working
- [ ] Health checks passing

### Authentication failure

**Symptoms**: "authentication failed", "password authentication failed", "role does not exist"

**Diagnosis**:

```bash
# Verify DATABASE_URL credentials correct
# Check if database password was rotated without updating application
# Check if database user was deleted or disabled
```

**Resolution**:

```bash
# If credentials incorrect: Update .env.production with correct DATABASE_URL
docker compose -f infra/compose/production.yml restart api worker

# If credentials rotated: Follow secret-rotation.md runbook
# If user deleted: Recreate user via provider console and update credentials
```

- [ ] Credentials verified/updated
- [ ] Services restarted
- [ ] Health checks passing

### Database disk full or performance degradation

**Symptoms**: Slow queries, high IOPS, disk full errors, extremely high latency

**Diagnosis**:

```bash
# Check provider console for:
# - Disk usage percentage
# - IOPS/throughput utilization
# - CPU/memory usage
# - Long-running queries
```

**Resolution**:

```bash
# If disk full:
# - Increase database storage via provider console
# - Clean up old data (logs, temp tables) if applicable
# - Review data growth rate and capacity planning

# If IOPS exhausted:
# - Increase provisioned IOPS
# - Optimize slow queries
# - Add database indexes

# If CPU/memory exhausted:
# - Scale database instance size
# - Optimize slow queries
# - Review connection pool size
```

- [ ] Storage/performance issue identified
- [ ] Instance scaled or optimized
- [ ] Health checks passing
- [ ] Capacity planning reviewed

---

## Escalation

### When to escalate to provider support

- Database instance unrecoverable via console
- Provider-wide outage suspected
- Unexpected failover or data loss
- Performance degradation with no obvious application cause
- RTO approaching 4-hour limit

### Provider support information

**Provider**: `[provider name]`  
**Support contact**: `[phone, email, portal URL]`  
**Support plan/SLA**: `[plan details]`  
**Account ID**: `[do not commit if sensitive]`

**Information to provide**:

- Instance identifier
- Timestamp of issue onset
- Symptoms and error messages
- Recent changes (deployments, configuration)
- Troubleshooting steps already taken

---

## If database unrecoverable

**Trigger**: Database instance destroyed, data corruption, RTO exceeded, provider cannot restore

**Escalation path**:

1. Declare major incident
2. Notify incident commander and stakeholders
3. Assess database restore from backup (see `docs/runbooks/database-restore.md`)
4. Prepare user communication about data loss window

**Critical decision**: Database restore vs wait for provider resolution

- [ ] Incident commander notified
- [ ] Restore decision made
- [ ] User communication prepared
- [ ] Follow database-restore.md runbook if restore required

---

## Post-incident actions

### 1. Record incident evidence

- **Incident ID**: `[unique identifier]`
- **Trigger timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Resolution timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Duration**: `[minutes]`
- **Root cause**: `[description]`
- **User impact**: `[description]`

### 2. Prevention measures

- [ ] Add monitoring/alerting to detect earlier
- [ ] Review capacity planning (connections, storage, IOPS)
- [ ] Review backup frequency and retention
- [ ] Update this runbook with lessons learned
- [ ] Test database failover capability (if supported)

### 3. Post-incident review

- [ ] Timeline documented
- [ ] Root cause identified
- [ ] Prevention measures implemented
- [ ] Provider SLA review (if provider issue)

---

## Emergency contacts

- **Incident commander**: `[contact]`
- **Database administrator**: `[contact]`
- **Provider support**: `[support contact]`
- **On-call engineer**: `[contact]`

---

## Related runbooks

- `docs/runbooks/database-restore.md` - Database recovery from backup
- `docs/runbooks/api-error-spike.md` - Elevated API errors
- `docs/runbooks/worker-failure.md` - Worker processing issues
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last incident**: `[date]`  
**Next review**: `[date]`
