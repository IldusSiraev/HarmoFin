# Database Restore Runbook

**Trigger**: Database corruption, data loss, catastrophic failure, or unrecoverable application state requiring database recovery

**Prerequisites**:
- Current backup evidence and restore drill completed
- Isolated restore target available
- Incident commander assigned
- User communication plan prepared

**Estimated duration**: 2-4 hours (RTO target: ≤ 4 hours)

**⚠️ WARNING**: Database restore is a destructive operation. Do not proceed without explicit authorization and verified backup.

---

## Restore decision gate

**STOP**: Database restore is the last resort. Verify that image rollback and application-level recovery cannot resolve the issue.

### Pre-restore checklist

- [ ] Image rollback attempted and failed (or not applicable)
- [ ] Root cause identified as database-level issue
- [ ] User impact assessed and communicated
- [ ] Incident commander assigned: `[name]`
- [ ] Database administrator available: `[name]`
- [ ] Backup verified within RPO window (≤1 hour): `[backup reference]`
- [ ] Recent restore drill evidence exists: `[restore drill record reference]`
- [ ] Data loss window calculated: `[minutes between last backup and incident]`
- [ ] Authorization obtained from: `[technical lead and incident commander]`

**Incident ID**: `[unique identifier]`  
**Authorization timestamp**: `[YYYY-MM-DD HH:MM UTC]`

---

## Pre-restore

### 1. Stop application services

**Purpose**: Prevent application writes during restore

```bash
# SSH to production host
ssh -i ~/.ssh/production_key production-user@production-host

# Stop application services (leave database running for snapshot)
cd /app/production
docker compose -f infra/compose/production.yml stop web api worker
```

- [ ] Web service stopped
- [ ] API service stopped
- [ ] Worker service stopped
- [ ] Database still running (do not stop)

### 2. Create snapshot of current database state

**Purpose**: Preserve forensic evidence and enable point-in-time analysis

```bash
# Trigger backup via provider console or CLI
# Record backup reference for post-incident analysis
```

**Forensic backup reference**: `[backup reference - do not commit to Git]`  
**Forensic backup timestamp**: `[YYYY-MM-DD HH:MM UTC]`

- [ ] Forensic snapshot created
- [ ] Forensic snapshot reference recorded
- [ ] Forensic snapshot will be retained for post-incident review

### 3. Identify restore target point

**Source backup**: `[backup reference - most recent before incident]`  
**Backup timestamp**: `[YYYY-MM-DD HH:MM UTC]`  
**Data loss window (RPO)**: `[minutes from backup to incident]`

- [ ] Restore point identified
- [ ] Data loss window calculated and communicated to stakeholders
- [ ] PITR target timestamp (if applicable): `[YYYY-MM-DD HH:MM UTC]`

---

## Restore execution

### 4. Initiate database restore

**⚠️ DESTRUCTIVE OPERATION**: This will replace production database with backup

**Restore method**: `[provider-specific restore procedure]`

```bash
# Provider-specific restore command or console procedure
# DO NOT include actual commands with credentials in Git
# Refer to provider documentation for exact procedure

# Example provider-neutral steps:
# 1. Navigate to provider database console
# 2. Select production database instance
# 3. Choose "Restore" from backup
# 4. Select backup reference: [backup reference]
# 5. Confirm destructive restore operation
# 6. Wait for restore completion
```

**Restore initiated**: `[YYYY-MM-DD HH:MM UTC]`

### 5. Monitor restore progress

```bash
# Monitor restore progress via provider console or CLI
# Track estimated completion time
```

**Estimated completion**: `[YYYY-MM-DD HH:MM UTC]`

- [ ] Restore in progress
- [ ] Monitoring provider console for completion
- [ ] No restore errors reported

**Restore completed**: `[YYYY-MM-DD HH:MM UTC]`  
**Actual RTO**: `[minutes from incident to restore completion]`

---

## Post-restore verification

### 6. Verify database accessibility

```bash
# Test database connection from application host
# Use production DATABASE_URL (credentials unchanged if restoring to same instance)

# Basic connectivity test (do not commit actual DATABASE_URL)
psql "$DATABASE_URL" -c "SELECT version();"
```

- [ ] Database accessible
- [ ] PostgreSQL version correct
- [ ] Connection pool can connect

### 7. Verify schema integrity

```bash
# Check Prisma migration history
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM _prisma_migrations;"
psql "$DATABASE_URL" -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# Verify expected tables exist
psql "$DATABASE_URL" -c "\dt"
```

**Schema verification**:
- [ ] Migration history table exists
- [ ] Expected migration version present: `[migration name]`
- [ ] All expected tables present
- [ ] No missing tables

### 8. Verify data integrity

```bash
# Run integrity checks
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"User\";"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"Workspace\";"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"Budget\";"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"Operation\";"

# Check foreign key constraints
# Check for orphaned records
```

**Data integrity**:
- [ ] Row counts within expected ranges
- [ ] Foreign key constraints valid
- [ ] No obvious data corruption
- [ ] Sample queries return expected results

### 9. Verify restore point accuracy

```bash
# Query most recent operation timestamp
psql "$DATABASE_URL" -c "SELECT MAX(created_at) FROM \"Operation\";"

# Verify restore point matches expected backup timestamp
```

**Latest operation timestamp**: `[YYYY-MM-DD HH:MM UTC]`  
**Expected data loss**: `[minutes]`  
**Actual data loss**: `[minutes - from latest operation to incident]`

- [ ] Restore point matches expected backup timestamp
- [ ] Data loss within communicated RPO window

---

## Application restart

### 10. Restart application services

```bash
# SSH to production host
cd /app/production

# Start services with restored database
docker compose -f infra/compose/production.yml up -d web api worker caddy
```

- [ ] Services started
- [ ] Health checks passing
- [ ] No database connection errors in logs

### 11. Verify application health

```bash
curl -f https://production-domain/
curl -f https://production-domain/api/v1/health/live
curl -f https://production-domain/api/v1/health/ready
```

- [ ] Web responds with 200
- [ ] API health probes respond with 200
- [ ] Worker health probes respond with 200

### 12. Test critical authenticated journey

- [ ] Sign-in works
- [ ] Budget list loads
- [ ] Journal query works with restored data
- [ ] Recent operations visible (within restored timeframe)
- [ ] No authentication errors

### 13. Verify observability

- [ ] Logs appearing in log backend
- [ ] Metrics updating
- [ ] No error rate spike
- [ ] Worker processing jobs

---

## Post-restore actions

### 14. Notify stakeholders of restoration

**User communication**:
```
[Template user communication about data loss window and service restoration]

Example:
"Service has been restored. Operations created between [backup timestamp] and 
[incident timestamp] were not recoverable and have been lost. We apologize for 
the inconvenience. All other data has been verified intact."
```

- [ ] Team notified of restore completion
- [ ] Users notified of data loss window (if applicable)
- [ ] Incident tracking system updated

### 15. Record restore evidence

Update `docs/operations/backup-restore-record.md` with:
- Incident ID and trigger
- Backup source and restore target
- Actual RTO and RPO
- Verification results
- Data loss assessment

### 16. Preserve forensic evidence

- [ ] Forensic backup reference recorded: `[reference]`
- [ ] Forensic backup will be retained for: `[retention period]`
- [ ] Post-incident analysis scheduled
- [ ] Root cause investigation assigned

---

## Post-incident review

**Mandatory post-incident actions**:

1. **Root cause analysis**
   - [ ] Identify what caused database corruption or failure
   - [ ] Document timeline of events
   - [ ] Identify missed detection opportunities

2. **Prevention measures**
   - [ ] Add monitoring/alerting to detect this failure mode earlier
   - [ ] Review backup frequency (currently targeting RPO ≤1 hour)
   - [ ] Review restore procedure for improvements
   - [ ] Update restore drill to cover this scenario

3. **Process improvements**
   - [ ] Update this runbook with lessons learned
   - [ ] Schedule next restore drill
   - [ ] Review communication templates
   - [ ] Assess RTO/RPO targets (currently 4 hours/1 hour)

---

## Emergency contacts

- **Incident commander**: `[contact]`
- **Database administrator**: `[contact]`
- **Provider support**: `[support contact with SLA details]`
- **On-call engineer**: `[contact]`

---

## Related runbooks

- `docs/runbooks/deploy.md` - Production deployment procedure
- `docs/runbooks/image-rollback.md` - Application rollback procedure
- `docs/runbooks/postgres-outage.md` - PostgreSQL connectivity issues
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last tested**: `[date from most recent restore drill]`  
**Next review**: `[date]`
