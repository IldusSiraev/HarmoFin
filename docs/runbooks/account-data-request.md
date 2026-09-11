# Account Data Request Runbook

**Trigger**: User requests data export, account deletion, or data correction under privacy regulations (GDPR, etc.)

**Prerequisites**:

- User identity verification completed
- Legal/compliance guidance on data retention and deletion
- Backup and audit requirements understood

**Estimated duration**: 30 minutes - 2 hours depending on request type

---

## Request types

### 1. Data export (right to data portability)

User requests copy of all their personal data in machine-readable format.

**Requirements**:

- Export all user data associated with their account
- Include data from all budgets they own or have access to
- Provide in structured, machine-readable format (JSON recommended)
- Deliver securely (not via unencrypted email)
- Complete within regulatory timeframe (typically 30 days)

### 2. Account deletion (right to be forgotten)

User requests permanent deletion of their account and associated data.

**Requirements**:

- Verify user identity and authorization
- Preserve audit trail and legally required data
- Handle shared budgets (user is member but not owner)
- Handle owned budgets (user is owner, may have other members)
- Complete within regulatory timeframe (typically 30 days)
- Cannot be undone

### 3. Data correction (right to rectification)

User requests correction of inaccurate personal data.

**Requirements**:

- Verify user identity
- Validate correction request
- Update data through normal application flow if possible
- Manual update if application flow insufficient

---

## Identity verification

**CRITICAL**: Verify user identity before processing any data request.

### Verification steps

```bash
# 1. User must be authenticated in application
# 2. Confirm email address matches account
# 3. For sensitive requests (deletion), require additional verification:
#    - Recent authentication (within last 15 minutes)
#    - Email confirmation link clicked
#    - Support ticket reference if initiated through support
```

**Verification checklist**:

- [ ] User authenticated in application
- [ ] Email address confirmed
- [ ] Recent authentication verified (for deletion)
- [ ] Support ticket reference: `[ticket ID if applicable]`
- [ ] Verified by: `[name and timestamp]`

---

## Data export procedure

### 1. Identify data scope

**Data to export**:

- User profile (name, email, preferences)
- Workspaces where user is member
- Budgets where user has access
- Operations created or modified by user
- Categories and envelopes configured by user
- Comments authored by user
- Account balances and totals (owned budgets only)
- Audit trail entries related to user actions

**Data NOT to export**:

- Other users' private data
- Budget data where user is not owner or member
- System secrets or credentials
- Internal identifiers not meaningful to user

### 2. Generate export

```bash
# SSH to production host
ssh production-user@production-host

# Run export script or manual query (customize for your schema)
psql "$DATABASE_URL" -c "
\copy (
  SELECT jsonb_build_object(
    'user', (SELECT row_to_json(u) FROM \"User\" u WHERE id = '[user-id]'),
    'workspaces', (SELECT jsonb_agg(row_to_json(w)) FROM \"WorkspaceMember\" wm JOIN \"Workspace\" w ON wm.workspace_id = w.id WHERE wm.user_id = '[user-id]'),
    'budgets', (SELECT jsonb_agg(row_to_json(b)) FROM \"BudgetMember\" bm JOIN \"Budget\" b ON bm.budget_id = b.id WHERE bm.user_id = '[user-id]')
    -- Add more data as needed
  )
) TO '/tmp/user-export-[user-id]-[timestamp].json';
"

# Download export file securely
scp production-user@production-host:/tmp/user-export-[user-id]-[timestamp].json .

# Remove temporary file from production host
ssh production-user@production-host rm /tmp/user-export-[user-id]-[timestamp].json
```

**Export file**: `user-export-[user-id]-[timestamp].json`

### 3. Review and sanitize export

- [ ] Review export for sensitive data (other users' data, system secrets)
- [ ] Verify export contains expected user data
- [ ] Ensure format is machine-readable (valid JSON)
- [ ] Sanitize any internal identifiers if needed

### 4. Deliver export securely

**Delivery methods** (in order of preference):

1. Secure download link in application (preferred if implemented)
2. Encrypted file via secure file sharing service (password-protected)
3. Email with password-protected ZIP (password sent separately)

**DO NOT**: Send unencrypted user data via email

**Delivery checklist**:

- [ ] Export delivered securely
- [ ] User notified of delivery
- [ ] Delivery method recorded
- [ ] Export file destroyed from temporary storage after delivery

---

## Account deletion procedure

### 1. Assess deletion impact

**Shared budget impact**:

```bash
# Check if user owns any budgets with other members
ssh production-user@production-host
psql "$DATABASE_URL" -c "
SELECT b.id, b.name, COUNT(bm.user_id) as member_count
FROM \"Budget\" b
JOIN \"BudgetMember\" bm ON b.budget_id = bm.budget_id
WHERE b.owner_user_id = '[user-id]'
GROUP BY b.id
HAVING COUNT(bm.user_id) > 1;
"
```

**Deletion scenarios**:

- **User owns budgets with no other members**: Delete budgets and all data
- **User owns budgets with other members**: Cannot auto-delete; require user to transfer ownership or remove members first
- **User is member of budgets owned by others**: Remove membership, preserve budget data

**Impact assessment**:

- [ ] User owns `[count]` budgets
- [ ] User is member of `[count]` budgets owned by others
- [ ] Budgets with other members: `[count]` (requires ownership transfer)
- [ ] Deletion impact communicated to user
- [ ] User confirmed deletion understanding

### 2. Handle budget ownership conflicts

**If user owns budgets with other members**:

```text
Cannot complete account deletion automatically. Please:
1. Transfer ownership of shared budgets to another member, OR
2. Remove other members from your budgets, OR
3. Contact support for assisted deletion

Affected budgets:
- [Budget name 1]: [member count] members
- [Budget name 2]: [member count] members
```

**User must resolve conflicts before deletion can proceed.**

### 3. Preserve audit trail

**Data to preserve** (for legal/audit requirements):

- User ID (as tombstone record)
- Account creation date
- Account deletion date
- Deletion request source and verification
- Financial operations audit trail (anonymized)

**Retention period**: Per legal requirements (typically 7 years for financial data)

### 4. Execute deletion

**⚠️ WARNING**: This action is permanent and cannot be undone.

```bash
# SSH to production host
ssh production-user@production-host

# Begin transaction
psql "$DATABASE_URL" <<'EOSQL'
BEGIN;

-- Delete user sessions
DELETE FROM "Session" WHERE user_id = '[user-id]';

-- Delete user memberships (budgets owned by others)
DELETE FROM "BudgetMember" WHERE user_id = '[user-id]' AND budget_id NOT IN (
  SELECT id FROM "Budget" WHERE owner_user_id = '[user-id]'
);

DELETE FROM "WorkspaceMember" WHERE user_id = '[user-id]' AND workspace_id NOT IN (
  SELECT id FROM "Workspace" WHERE owner_user_id = '[user-id]'
);

-- Delete owned budgets (and cascading data)
-- Assumes foreign keys set up with ON DELETE CASCADE for:
-- - Operations, Categories, Envelopes, Accounts, etc.
DELETE FROM "Budget" WHERE owner_user_id = '[user-id]';

-- Delete owned workspaces (if no other members)
DELETE FROM "Workspace" WHERE owner_user_id = '[user-id]' AND id NOT IN (
  SELECT workspace_id FROM "WorkspaceMember" WHERE user_id != '[user-id]'
);

-- Anonymize or delete user record (preserve audit trail)
UPDATE "User" SET
  email = '[deleted-user-[user-id]@example.invalid]',
  name = 'Deleted User',
  password_hash = '',
  is_deleted = true,
  deleted_at = NOW()
WHERE id = '[user-id]';

-- Verify deletion
SELECT
  (SELECT COUNT(*) FROM "Session" WHERE user_id = '[user-id]') as remaining_sessions,
  (SELECT COUNT(*) FROM "Budget" WHERE owner_user_id = '[user-id]') as remaining_budgets,
  (SELECT is_deleted FROM "User" WHERE id = '[user-id]') as user_deleted;

COMMIT;
EOSQL
```

**Deletion verification**:

- [ ] User sessions deleted
- [ ] Budget memberships removed
- [ ] Owned budgets deleted (or ownership transferred)
- [ ] User record anonymized/marked deleted
- [ ] Audit trail preserved

### 5. Verify deletion and notify user

```bash
# Verify user cannot authenticate
curl -f https://production-domain/api/v1/auth/sign-in -d '{"email":"[user-email]","password":"[any-password]"}'
# Should return 401 Unauthorized or "User not found"
```

**User notification**:

```
Subject: Account deletion completed

Your HarmoFin account and associated data have been permanently deleted as requested.

Deleted data:
- User profile
- [N] budgets owned by you
- [N] operations across all budgets
- All preferences and settings

Preserved data (legal/audit requirements):
- Anonymized audit trail for financial operations
- Account deletion record

You will no longer receive emails from HarmoFin.

If you did not request this deletion, please reply immediately.
```

---

## Data correction procedure

### 1. Identify data to correct

**Correction request**:

- Field to correct: `[user name, email, preferences, etc.]`
- Current value: `[current value - redact if sensitive]`
- Requested value: `[requested value - redact if sensitive]`
- Reason: `[user explanation]`

### 2. Validate correction

- [ ] User identity verified
- [ ] Correction request is reasonable (not fraudulent)
- [ ] Corrected value meets validation rules
- [ ] Correction does not violate data integrity

### 3. Apply correction

**Preferred method**: User updates through application UI

**If manual update required**:

```bash
# SSH to production host
ssh production-user@production-host

# Apply correction
psql "$DATABASE_URL" -c "
UPDATE \"User\"
SET [field] = '[new-value]', updated_at = NOW()
WHERE id = '[user-id]';
"

# Verify correction
psql "$DATABASE_URL" -c "
SELECT id, [field], updated_at FROM \"User\" WHERE id = '[user-id]';
"
```

**Correction record**:

- [ ] Correction applied
- [ ] User notified of completion
- [ ] Correction logged for audit

---

## Compliance and legal

### GDPR compliance (if applicable)

- [ ] Data export completed within 30 days
- [ ] Account deletion completed within 30 days
- [ ] Data correction completed within 30 days
- [ ] User identity verified before processing
- [ ] Audit trail preserved per legal requirements
- [ ] User notified of completion

### Data retention

**Retention policy**:

- Active user data: Retained while account active
- Deleted user data: Anonymized, audit trail retained for 7 years
- Backup retention: `[retention period]`
- Log retention: `[retention period]`

---

## Record keeping

### Request record

- **Request ID**: `[unique identifier]`
- **Request type**: `[export | deletion | correction]`
- **User ID**: `[user-id]`
- **Request date**: `[YYYY-MM-DD]`
- **Verification date**: `[YYYY-MM-DD]`
- **Completion date**: `[YYYY-MM-DD]`
- **Processed by**: `[name]`
- **Outcome**: `[completed | rejected | pending]`
- **Notes**: `[any special circumstances]`

**Record storage**: `[protected compliance record system - not Git]`

---

## Emergency contacts

- **Privacy officer**: `[contact]`
- **Legal/compliance**: `[contact]`
- **Data protection officer**: `[contact if required by jurisdiction]`

---

## Related runbooks

- `docs/runbooks/suspicious-activity.md` - Security incident response
- `docs/runbooks/incident-escalation.md` - Incident response escalation

---

**Runbook version**: 2026-09-09  
**Last request**: `[date]`  
**Next review**: `[date]`
