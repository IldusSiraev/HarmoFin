# Suspicious Activity Runbook

**Trigger**: Unauthorized access detected, anomalous traffic patterns, security alert, potential account compromise

**Prerequisites**:
- Access logs and security monitoring available
- Incident response team contact information
- Ability to disable accounts and revoke sessions

**Estimated duration**: 30 minutes - 4 hours depending on severity and scope

---

## Symptoms

Common indicators of suspicious activity:

- Multiple failed authentication attempts from single IP
- Successful authentication from unusual location or device
- Unusual API usage patterns (scraping, enumeration)
- Elevated rate of specific operations (account creation, password resets)
- Security alert from monitoring system
- User report of unauthorized access to their account
- Unexpected database queries or data access patterns

---

## Severity assessment

### Critical (immediate action required)

- Confirmed unauthorized access to production database
- Confirmed unauthorized access to administrative accounts
- Evidence of data exfiltration
- Active ongoing attack (DDoS, injection attempts)
- Credential compromise confirmed

**Action**: Proceed immediately to containment, notify security team

### High (urgent investigation)

- Multiple failed authentication attempts from many IPs (credential stuffing)
- Successful authentication from suspicious location
- Unusual API usage suggesting enumeration or scraping
- User report of compromised account

**Action**: Investigate and contain within 1 hour

### Medium (investigation required)

- Single user reporting unusual activity
- Anomalous traffic patterns without clear attack signature
- Failed authentication attempts within normal threshold

**Action**: Investigate within 4 hours, monitor for escalation

---

## Initial investigation

### 1. Identify affected accounts and scope

```bash
# Review authentication logs for suspicious patterns
# Query log backend for:
# - Failed authentication attempts by IP
# - Successful authentications from new locations
# - Unusual API access patterns by user

# Example log queries (adjust for your log backend):
# - "auth/sign-in" AND status:401 group by ip in last hour
# - "auth/sign-in" AND status:200 AND ip:[suspicious-ip]
# - user_id:[affected-user] in last 24 hours
```

**Investigation findings**:
- Suspicious IP(s): `[IP addresses]`
- Affected user account(s): `[user IDs or emails - redact in Git]`
- Time range: `[start - end timestamp]`
- Activity pattern: `[description]`

### 2. Review access logs

```bash
# Check what actions were performed by suspicious account/IP
# Look for:
# - Budget/workspace access
# - Financial operation queries
# - Account settings changes
# - Data export requests
# - API enumeration attempts

# Query for recent activity by affected user or IP
```

**Access summary**:
- Budgets accessed: `[count]`
- Operations queried: `[count]`
- Sensitive actions: `[list any concerning actions]`
- Data potentially exposed: `[assessment]`

### 3. Assess attack vector

**Possible vectors**:
- [ ] Credential stuffing (leaked password from another site)
- [ ] Phishing (user tricked into giving credentials)
- [ ] Session hijacking (stolen session cookie)
- [ ] SQL injection or other application vulnerability
- [ ] Compromised device or browser
- [ ] Insider threat
- [ ] API key compromise (if applicable)

**Evidence**: `[what indicates this vector]`

---

## Containment

### For compromised user account

```bash
# 1. Revoke all sessions for affected user
ssh production-user@production-host
psql "$DATABASE_URL" -c "
DELETE FROM \"Session\" WHERE user_id = '[affected-user-id]';
"

# 2. Force password reset on next login (if user table supports)
psql "$DATABASE_URL" -c "
UPDATE \"User\" 
SET password_reset_required = true 
WHERE id = '[affected-user-id]';
"

# 3. Lock account if necessary (if active attack ongoing)
psql "$DATABASE_URL" -c "
UPDATE \"User\" 
SET is_locked = true, locked_at = NOW(), locked_reason = 'Security investigation'
WHERE id = '[affected-user-id]';
"
```

**Containment actions**:
- [ ] Sessions revoked for affected user(s)
- [ ] Password reset required
- [ ] Account locked (if necessary)
- [ ] User notified of security action

### For suspicious IP or pattern

```bash
# If rate limiting or IP blocking available:
# - Add IP to temporary block list
# - Apply stricter rate limits

# Via application configuration or infrastructure firewall
# (Provider-specific commands - do not commit actual IPs)
```

**IP containment**:
- [ ] Suspicious IP(s) identified
- [ ] Rate limiting applied
- [ ] IP blocked (if confirmed attack)

### For credential compromise

```bash
# If application credentials compromised (not user accounts):
# - Follow secret-rotation.md runbook
# - Revoke compromised API keys/tokens
# - Rotate affected secrets immediately
```

**Credential containment**:
- [ ] Compromised credentials identified
- [ ] Secrets rotated (see docs/runbooks/secret-rotation.md)
- [ ] Access logs reviewed for unauthorized usage

---

## Evidence collection

### 1. Preserve logs

```bash
# Export relevant logs for forensic analysis
# - Authentication attempts
# - API access by affected user/IP
# - Database query logs (if available)

# Store evidence securely outside production environment
```

**Evidence preserved**:
- [ ] Authentication logs exported
- [ ] Access logs exported
- [ ] Database audit logs exported (if available)
- [ ] Evidence stored securely: `[protected storage location]`

### 2. Document timeline

**Timeline of events**:
```
[YYYY-MM-DD HH:MM] First suspicious activity detected
[YYYY-MM-DD HH:MM] Alert triggered or investigation started
[YYYY-MM-DD HH:MM] Containment actions taken
[YYYY-MM-DD HH:MM] User notified
[YYYY-MM-DD HH:MM] Investigation completed
```

### 3. Assess data exposure

**Data exposure assessment**:
- [ ] User personal information accessed
- [ ] Financial operations/balances accessed
- [ ] Budget data accessed
- [ ] Comments or sensitive notes accessed
- [ ] Data modified or deleted
- [ ] Data exfiltrated (exported or scraped)

**Impact summary**: `[description of what data was potentially compromised]`

---

## User communication

### For compromised user account

**Notification template**:
```
Subject: Security notice - action required

We detected unusual activity on your HarmoFin account from [location/IP] on [date/time].

As a precaution, we have:
- Signed you out of all sessions
- Required a password reset on your next login
- [Locked your account temporarily - if applicable]

Please reset your password immediately and review your account activity.

If you did not authorize this activity, please reply to this email immediately.

We recommend:
- Use a strong, unique password for HarmoFin
- Enable two-factor authentication (if available)
- Review your recent account activity for unauthorized changes
```

**Communication checklist**:
- [ ] User notified of security incident
- [ ] Actions taken communicated
- [ ] Next steps provided
- [ ] Support contact provided

### For security incident disclosure

**If data breach or widespread impact**:
- [ ] Security incident response team notified
- [ ] Legal/compliance team notified
- [ ] Disclosure timeline determined
- [ ] User communication prepared
- [ ] Regulatory reporting requirements assessed

---

## Escalation

### When to escalate

- Confirmed unauthorized database access
- Evidence of data exfiltration
- Widespread attack affecting multiple users
- Application vulnerability exploited
- Credentials compromise requiring emergency rotation
- Legal or compliance implications

### Emergency contacts

- **Security incident commander**: `[contact]`
- **Legal/compliance**: `[contact]`
- **On-call engineer**: `[contact]`
- **Provider security support**: `[support contact]`

---

## Post-incident actions

### 1. Record incident evidence

- **Incident ID**: `[unique identifier]`
- **Detection timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Containment timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Resolution timestamp**: `[YYYY-MM-DD HH:MM UTC]`
- **Attack vector**: `[confirmed or suspected]`
- **Affected users**: `[count - do not list in Git]`
- **Data exposure**: `[assessment]`

### 2. Root cause analysis

- [ ] Attack vector confirmed
- [ ] Application vulnerability identified (if applicable)
- [ ] Security control gap identified
- [ ] Detection delay analyzed

### 3. Prevention measures

**Technical controls**:
- [ ] Rate limiting enhanced
- [ ] Authentication security hardened (captcha, MFA, etc.)
- [ ] Monitoring/alerting added for this pattern
- [ ] Application vulnerability patched
- [ ] Infrastructure firewall rules updated

**Process improvements**:
- [ ] Incident response process updated
- [ ] User communication templates updated
- [ ] Logging/monitoring coverage expanded
- [ ] Security training for team

### 4. User follow-up

- [ ] Affected users notified of resolution
- [ ] Account access restored (if locked)
- [ ] Additional security recommendations provided
- [ ] Follow-up communication after 7 days

---

## Prevention and detection

**Recommended security controls**:
- Rate limiting on authentication endpoints
- Account lockout after N failed attempts
- Monitoring for unusual login locations/devices
- Session timeout and absolute maximum session lifetime
- Strong password requirements (length, complexity)
- Two-factor authentication (future enhancement)
- CAPTCHA on authentication (if bot activity detected)

**Recommended alerts**:
- Multiple failed authentication attempts from single IP (>10 in 5 min)
- Successful authentication from new country/ASN
- Elevated API error rate (potential injection attempts)
- Unusual data access patterns (rapid enumeration)
- Database query anomalies (unusual WHERE clauses, table scans)

---

## Related runbooks

- `docs/runbooks/secret-rotation.md` - Credential rotation procedure
- `docs/runbooks/incident-escalation.md` - Incident response escalation
- `docs/runbooks/account-data-request.md` - User data access/deletion requests

---

**Runbook version**: 2026-09-09  
**Last incident**: `[date]`  
**Next review**: `[date]`
