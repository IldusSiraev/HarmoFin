# Incident Escalation Runbook

**Purpose**: Define escalation paths, decision gates, and communication protocols for production incidents

**Scope**: All production incidents requiring coordination beyond single on-call engineer

---

## Incident severity levels

### SEV-1: Critical

**Definition**: Complete service outage or critical security breach

**Examples**:

- Production completely unavailable (all users affected)
- Database destroyed or corrupted beyond immediate recovery
- Confirmed data breach or unauthorized access to production data
- Financial data integrity compromise
- Security vulnerability actively exploited

**Response**:

- Immediate incident commander assignment
- All hands on deck
- Executive notification within 15 minutes
- Hourly status updates to stakeholders
- Post-incident review mandatory

**Target resolution**: 1-4 hours

### SEV-2: Major

**Definition**: Significant service degradation or data integrity risk

**Examples**:

- Core functionality unavailable (authentication, budget access, operations)
- Database connectivity failure affecting all services
- Elevated error rate (>5%) affecting majority of users
- Deployment failure requiring rollback
- Security incident requiring immediate containment

**Response**:

- Incident commander assignment
- On-call engineer plus specialists as needed
- Stakeholder notification within 30 minutes
- Status updates every 2 hours
- Post-incident review recommended

**Target resolution**: 4-8 hours

### SEV-3: Minor

**Definition**: Limited service degradation or isolated failures

**Examples**:

- Single feature unavailable (notifications, exports)
- Elevated error rate affecting specific endpoint
- Worker backlog growing but not critical
- Performance degradation within acceptable range
- Non-critical external service failure

**Response**:

- On-call engineer handles
- Incident commander optional
- Stakeholder notification within 2 hours if user-facing
- Status update on resolution
- Post-incident review optional

**Target resolution**: 8-24 hours

### SEV-4: Monitoring/Investigation

**Definition**: Anomaly detected but no confirmed user impact

**Examples**:

- Alert triggered but services healthy
- Anomalous traffic pattern under investigation
- Potential security concern requiring investigation
- Monitoring gap identified

**Response**:

- On-call engineer investigates
- No immediate escalation unless confirmed issue
- Document findings
- No post-incident review required

**Target resolution**: Best effort

---

## Escalation paths

### Primary escalation chain

```
On-call Engineer
  ↓ (if cannot resolve in 30 min for SEV-1, 1 hour for SEV-2)
Incident Commander
  ↓ (if requires specialist or cross-team coordination)
Technical Lead / Domain Specialist
  ↓ (if SEV-1 or major data/security issue)
Executive Leadership
```

### Specialist escalation

**Database issues**: Database Administrator + Provider Support  
**Security incidents**: Security Team + Legal/Compliance  
**Infrastructure**: Provider Support + Operations Team  
**Application bugs**: Backend Team Lead + QA  
**Financial data integrity**: Product Owner + Database Administrator

### External escalation

**Provider outage**: Open support ticket, escalate to TAM if available  
**Security breach**: Security incident response team, legal, compliance  
**Regulatory impact**: Legal, compliance, data protection officer  
**User communication**: Support team lead, communications

---

## Incident commander role

### When to assign incident commander

- Any SEV-1 incident
- SEV-2 incident requiring coordination across multiple responders
- Any incident lasting >1 hour with active troubleshooting
- Security incidents requiring containment decisions
- Any incident where on-call engineer requests coordination support

### Incident commander responsibilities

1. **Coordination**: Organize responders, assign tasks, track progress
2. **Communication**: Status updates to stakeholders, user communication decisions
3. **Decision-making**: Rollback decisions, escalation decisions, resource allocation
4. **Documentation**: Ensure timeline and actions documented
5. **Post-incident**: Schedule and facilitate post-incident review

### Incident commander does NOT

- Perform technical troubleshooting (delegates to specialists)
- Override specialist technical decisions without consultation
- Skip established safety procedures (backup verification, rollback gates)

---

## Communication protocols

### Internal communication

**Primary channel**: `[Slack/Teams channel or incident chat room]`

**Communication frequency**:

- SEV-1: Every 30 minutes or on significant status change
- SEV-2: Every 1-2 hours or on significant status change
- SEV-3: On resolution or daily if multi-day

**Status update template**:

```
Incident: [ID and brief description]
Severity: SEV-[1/2/3]
Status: [investigating | mitigating | resolved]
Impact: [user impact description]
ETA: [estimated resolution time or "investigating"]
Next update: [timestamp]
```

### External communication (users)

**Decision gate**: Incident commander approves user communication

**When to communicate**:

- SEV-1: Immediately (within 15 minutes of confirmation)
- SEV-2: Within 30 minutes if user-facing impact
- SEV-3: On resolution if degradation noticed by users
- SEV-4: No user communication unless evolves to higher severity

**Communication channels**:

- Status page update (if available)
- In-app notification (if available)
- Email to affected users (if targeted)
- Social media (if widespread and public-facing)

**User communication template**:

```
Subject: [Service incident | Service restored]

Status: [investigating | mitigating | monitoring | resolved]

Impact: [Brief description of what users are experiencing]

We are [investigating the issue | implementing a fix | monitoring recovery].

[Optional: Workaround or recommended user actions]

Next update: [timeframe]

We apologize for the inconvenience.
```

### Executive notification

**Trigger**:

- Any SEV-1 incident
- SEV-2 incident with potential legal/regulatory/PR impact
- Security breach or data integrity issue
- Incident approaching SLA breach

**Notification includes**:

- Incident severity and user impact
- Root cause (if known)
- Current status and ETA
- Potential legal/regulatory/PR implications
- Resources committed

---

## Escalation decision trees

### Should I escalate to incident commander?

```
Is this SEV-1? → YES → Assign incident commander immediately
  ↓ NO
Can I resolve alone in <30 min? → YES → Continue, reassess in 30 min
  ↓ NO
Do I need specialist help? → YES → Assign incident commander to coordinate
  ↓ NO
Escalate to incident commander
```

### Should I rollback?

```
Is service completely broken? → YES → Rollback (follow image-rollback.md)
  ↓ NO
Is error rate >10%? → YES → Rollback
  ↓ NO
Is migration backward-compatible? → NO → Cannot rollback (forward-fix only)
  ↓ YES
Is forward-fix available in <30 min? → YES → Consider forward-fix
  ↓ NO
Rollback (follow image-rollback.md)
```

### Should I restore database?

```
Is database corrupted? → NO → Do not restore
  ↓ YES
Can app rollback resolve? → YES → Try rollback first
  ↓ NO
Is data loss acceptable? → NO → Escalate to exec + legal
  ↓ YES
Do we have verified backup? → NO → Escalate to exec + DBA
  ↓ YES
Follow database-restore.md with incident commander + DBA
```

---

## Incident lifecycle

### 1. Detection

**Sources**:

- Monitoring alert
- User report
- On-call engineer observation
- External notification (provider, security)

**Actions**:

- Acknowledge alert
- Create incident record
- Begin investigation

### 2. Triage

**Actions**:

- Assess severity (SEV-1/2/3/4)
- Identify affected systems and users
- Review recent changes (deployments, config)
- Assign incident commander if needed

### 3. Investigation

**Actions**:

- Review logs and metrics
- Test hypothesis
- Identify root cause or containment approach
- Document timeline

### 4. Mitigation

**Actions**:

- Execute mitigation plan (rollback, restart, config change)
- Verify mitigation effectiveness
- Monitor for recurrence
- Update stakeholders

### 5. Recovery

**Actions**:

- Verify all systems healthy
- Confirm user impact resolved
- Monitor for stability
- Declare incident resolved

### 6. Post-incident

**Actions**:

- Schedule post-incident review
- Document timeline and root cause
- Identify prevention measures
- Assign action items
- Update runbooks

---

## Post-incident review

### When required

- All SEV-1 incidents
- SEV-2 incidents with user impact >1 hour
- Security incidents
- Incidents revealing process or tooling gaps
- Incidents requested by stakeholders

### Review agenda

1. **Timeline**: What happened and when
2. **Root cause**: Why did it happen
3. **Detection**: How did we discover it, how fast
4. **Response**: What we did, what worked, what didn't
5. **Impact**: User impact, business impact, SLA impact
6. **Prevention**: How to prevent recurrence
7. **Action items**: Specific, assigned, dated

### Review attendees

- Incident commander (facilitator)
- On-call engineer(s)
- Specialists who participated
- Technical lead
- Product owner (if user impact)

### Review outcomes

- [ ] Timeline documented
- [ ] Root cause identified
- [ ] Prevention measures identified
- [ ] Action items assigned with owners and due dates
- [ ] Runbooks updated with lessons learned
- [ ] Monitoring/alerting gaps addressed

---

## Incident record template

```
Incident ID: [unique identifier]
Severity: SEV-[1/2/3/4]
Status: [open | investigating | mitigating | resolved | closed]

Detection:
- Detected: [YYYY-MM-DD HH:MM UTC]
- Detected by: [alert | user report | engineer]
- Detection lag: [minutes from start to detection]

Impact:
- User impact: [description and user count]
- Duration: [minutes]
- Affected services: [list]

Response:
- Incident commander: [name]
- Responders: [names]
- Mitigation: [description]
- Resolution: [YYYY-MM-DD HH:MM UTC]

Root cause:
- [Description or "under investigation"]

Timeline:
[HH:MM] Event
[HH:MM] Event
...

Action items:
- [ ] Action 1 - Owner: [name] - Due: [date]
- [ ] Action 2 - Owner: [name] - Due: [date]

Post-incident review: [date scheduled]
```

---

## Emergency contacts

| Role                   | Primary         | Secondary   | Escalation path    |
| ---------------------- | --------------- | ----------- | ------------------ |
| On-call engineer       | `[contact]`     | `[contact]` | Incident commander |
| Incident commander     | `[contact]`     | `[contact]` | Technical lead     |
| Technical lead         | `[contact]`     | `[contact]` | Executive          |
| Database administrator | `[contact]`     | `[contact]` | Provider support   |
| Security team          | `[contact]`     | `[contact]` | Legal/compliance   |
| Provider support       | `[contact/URL]` | -           | TAM (if available) |
| Legal/compliance       | `[contact]`     | -           | Executive          |
| Executive on-call      | `[contact]`     | -           | -                  |

**Contact information storage**: `[protected operations record system - not Git]`

---

## Related runbooks

- `docs/runbooks/deploy.md` - Production deployment
- `docs/runbooks/image-rollback.md` - Application rollback
- `docs/runbooks/database-restore.md` - Database recovery
- All other runbooks reference this for escalation

---

**Runbook version**: 2026-09-09  
**Last incident**: `[date and ID]`  
**Next review**: `[date]`
