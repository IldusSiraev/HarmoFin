# Backup and Restore Record

This document templates evidence from backup verification and restore drills. Complete a restore drill before any potentially destructive migration or as part of production readiness verification.

## Restore drill metadata

- **Drill ID**: `[unique identifier]`
- **Drill date/time**: `[YYYY-MM-DD HH:MM UTC]`
- **Executed by**: `[name and contact]`
- **Source environment**: `[staging | production | anonymized-production]`
- **Target environment**: `[isolated-restore-target]`
- **Purpose**: `[production readiness | pre-migration verification | incident drill]`

## Source backup information

- **Backup reference**: `[protected backup identifier - do not commit to Git]`
- **Backup timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Backup method**: `[automated | manual | PITR]`
- **Backup size**: `[size in GB]`
- **Source schema version**: `[Prisma migration version or database schema hash]`

**Data classification:**
- [ ] Production data (requires anonymization before non-production use)
- [ ] Staging data (safe for restore drill)
- [ ] Anonymized production-derived data

## Restore target information

- **Target instance**: `[hostname or instance identifier - do not commit if sensitive]`
- **Target isolation**: 
  - [ ] No production network access
  - [ ] No external network access
  - [ ] Isolated credentials (not shared with production)
  - [ ] Temporary instance for drill only
- **Target PostgreSQL version**: `[version]`
- **Target capacity**: `[CPU, memory, storage]`

## Restore procedure

### Start time
- **Restore initiated**: `[YYYY-MM-DD HH:MM UTC]`

### Steps executed
```
[Document exact restore commands/procedure followed, excluding credentials]

Example:
1. Provisioned isolated PostgreSQL instance restore-drill-20260909
2. Restored from backup backup-staging-20260909-0800 using provider restore tool
3. Waited for restore completion
4. Verified instance reachable
5. Ran schema verification queries
6. Ran data integrity checks
```

### Completion time
- **Restore completed**: `[YYYY-MM-DD HH:MM UTC]`
- **Elapsed time (RTO)**: `[minutes or hours]`

### RPO verification
- **Intended restore point**: `[YYYY-MM-DD HH:MM UTC]`
- **Actual restore point**: `[YYYY-MM-DD HH:MM UTC]`
- **Data loss window (RPO)**: `[minutes]`

## Verification results

### Schema verification
- [ ] Database accessible with correct credentials
- [ ] All expected tables present
- [ ] Prisma migration history table present
- [ ] Current migration version matches source: `[migration name/hash]`

**Schema verification queries:**
```sql
-- Example verification queries (customize for your schema)
SELECT COUNT(*) FROM _prisma_migrations;
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
SELECT COUNT(*) FROM "User";
SELECT COUNT(*) FROM "Workspace";
SELECT COUNT(*) FROM "Budget";
```

**Results:**
```
[Query results confirming schema integrity]
```

### Data integrity verification
- [ ] Row counts match expected ranges
- [ ] Foreign key constraints intact
- [ ] No obvious data corruption
- [ ] Sample queries return expected results

**Integrity checks:**
```
[Document sample queries and results verifying data integrity]

Example:
- User count: 42 (expected: ~40-50)
- Workspace count: 15
- Budget count: 23
- All foreign keys valid: SELECT ... WHERE budget_id NOT IN (SELECT id FROM "Budget") returned 0 rows
```

### Anonymization verification (if applicable)
- [ ] PII removed or anonymized (emails, names, phone numbers)
- [ ] Financial data preserved for schema validation
- [ ] Authentication secrets invalidated

### Application connectivity test
- [ ] Can connect with application DATABASE_URL format
- [ ] Read query succeeds
- [ ] Transaction commit/rollback works

**Connection test:**
```
[Document connection test procedure and results]
```

## Issues and remediation

**Issues encountered:**
```
[Document any failures, unexpected behavior, or performance issues during restore]

Example:
- None
OR
- Restore took 15 minutes longer than expected due to database size growth
- Had to manually adjust connection pool settings for target instance
```

**Remediation actions:**
```
[Document fixes applied and recommendations for next drill]
```

## Restore drill outcome

- [ ] **Success**: Restore completed within RTO, schema and data verified
- [ ] **Success with issues**: Restore completed but identified improvement areas
- [ ] **Failure**: Restore did not complete or verification failed

**RTO achieved**: `[minutes/hours]` (Target: ≤ 4 hours)  
**RPO achieved**: `[minutes]` (Target: ≤ 1 hour)

## Target cleanup

- **Cleanup completed**: `[YYYY-MM-DD HH:MM UTC]`
- [ ] Restore target instance terminated
- [ ] Temporary credentials revoked
- [ ] Temporary network access removed
- [ ] Temporary storage destroyed

**Cleanup verification:**
```
[Confirm no restore artifacts remain accessible]
```

## Recommendations

**Backup strategy:**
```
[Recommendations for backup frequency, retention, or procedure improvements]
```

**Restore procedure:**
```
[Recommendations for restore process improvements based on drill findings]
```

**Next drill date:**
```
[Recommended date for next restore drill - typically quarterly or before major migrations]
```

## Approvals

| Role | Name | Reviewed | Date |
|------|------|----------|------|
| Operations owner | | ☐ | |
| Database administrator | | ☐ | |

---

**Template version**: 2026-09-09  
**Protected evidence location**: `[secure operations record system - not Git]`  
**Related runbook**: `docs/runbooks/database-restore.md`
