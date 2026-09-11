# Provider Capability Checklist

This checklist verifies that a provider meets HarmoFin production requirements. Complete before provisioning staging or production environments.

## Provider identification

- **Provider name**: `[provider name]`
- **Evaluated by**: `[name]`
- **Evaluation date**: `[YYYY-MM-DD]`
- **Target environment**: `[staging | production]`

## Mandatory capabilities

### Compute and container runtime

- [ ] Linux VMs or container runtime supporting Docker Compose
- [ ] Isolated hosts for staging and production (no shared infrastructure)
- [ ] SSH access with key-based authentication or equivalent secure remote management
- [ ] Firewall/security group capability to restrict inbound traffic
- [ ] Outbound HTTPS connectivity for package installation and registry access
- [ ] Sufficient CPU/memory for web, API, worker containers (minimum 2 vCPU, 4GB RAM)
- [ ] Persistent storage for application files and named volumes

**Notes:**
```
[Provider-specific compute details, instance types, regions]
```

### Managed PostgreSQL

- [ ] PostgreSQL 18 or compatible version
- [ ] Private network access only (no public exposure required)
- [ ] Encryption at rest
- [ ] Encryption in transit (TLS connection support)
- [ ] Automated backups with configurable retention
- [ ] Point-in-time recovery (PITR) capability
- [ ] RPO ≤ 1 hour achievable with backup frequency
- [ ] RTO ≤ 4 hours achievable with documented restore procedure
- [ ] Isolated restore target capability (can restore to separate instance)
- [ ] Backup storage in separate failure domain (if provider supports)
- [ ] Sufficient capacity for MVP dataset and growth (minimum 20GB)

**Notes:**
```
[Backup schedule, retention policy, restore procedure reference]
```

### Networking and DNS

- [ ] Domain registration or transfer capability
- [ ] DNS management with A/AAAA record support
- [ ] TLS certificate provisioning (Let's Encrypt via ACME or managed certificates)
- [ ] Static public IP or stable DNS hostname for compute instances
- [ ] Private network between compute and PostgreSQL
- [ ] Firewall rules to restrict database access to application host only

**Notes:**
```
[Domain management, DNS provider, certificate approach]
```

### Secrets and credentials

- [ ] Secret manager or secure credential injection mechanism
- [ ] Secrets isolated per environment (staging/production)
- [ ] Rotation capability for database passwords, SSH keys, API tokens
- [ ] Secure transmission of secrets (no plaintext in email/chat)
- [ ] Access audit logging for secret retrieval

**Alternative:** Environment file injection via secure deployment automation (acceptable for MVP with documented access controls)

**Notes:**
```
[Secret management approach, rotation procedures]
```

### Container registry

- [ ] OCI-compliant container registry (Docker Hub, GitHub Container Registry, provider registry)
- [ ] Private registry support with authentication
- [ ] Pull access from compute instances
- [ ] Image retention and cleanup policy
- [ ] Bandwidth/transfer sufficient for image pulls

**Notes:**
```
[Registry choice, authentication method, retention policy]
```

### SMTP and email delivery

- [ ] Transactional email service or SMTP relay
- [ ] TLS support (STARTTLS or SMTPS)
- [ ] Authentication (username/password or API key)
- [ ] Sufficient sending quota for MVP user volume
- [ ] Delivery monitoring and bounce handling

**Notes:**
```
[SMTP provider, sending limits, monitoring approach]
```

### Observability and monitoring

- [ ] Prometheus-compatible metrics collector or managed monitoring service
- [ ] Log aggregation capability (syslog, fluentd, managed logging)
- [ ] Error reporting backend (Sentry-compatible or equivalent)
- [ ] OpenTelemetry-compatible tracing backend (optional but recommended)
- [ ] Alert routing to on-call engineers (email, SMS, Slack, PagerDuty, etc.)
- [ ] Dashboard capability for health, latency, errors, backlog metrics

**Notes:**
```
[Monitoring stack, alert routing, dashboard access]
```

### Security and compliance

- [ ] Firewall/security group to restrict database to application host only
- [ ] Firewall to restrict SSH/management access to authorized IPs
- [ ] TLS 1.2+ for all external connections
- [ ] Audit logging for administrative actions
- [ ] Data residency meets jurisdiction requirements
- [ ] Provider SLA and support responsiveness acceptable
- [ ] Incident response and security contact documented

**Notes:**
```
[Security controls, compliance requirements, incident contacts]
```

### CI/CD integration

- [ ] GitHub Actions can authenticate to deployment target (SSH keys, OIDC, service accounts)
- [ ] GitHub Environment secrets protected per environment
- [ ] GitHub Environment protection rules with required approvers for production
- [ ] Deployment automation can access registry, SSH to host, inject secrets

**Notes:**
```
[CI/CD authentication method, GitHub Environment setup]
```

### Cost and operational constraints

- [ ] Estimated monthly cost within budget for staging and production
- [ ] Billing alerts configured
- [ ] Support plan adequate for production incident response
- [ ] Provider stability and track record acceptable
- [ ] Migration/exit strategy documented if provider changes

**Notes:**
```
[Cost estimates, support plan, migration considerations]
```

## Optional enhancements

- [ ] CDN or edge caching for static assets
- [ ] WAF (Web Application Firewall) for DDoS/attack mitigation
- [ ] Multi-region backup replication
- [ ] Read replicas for database scaling
- [ ] Object storage for file uploads (when product requires)
- [ ] Managed Redis or equivalent for caching (when product requires)

**Notes:**
```
[Future enhancements, scaling considerations]
```

## Provider decision

- [ ] **Approved**: Provider meets all mandatory capabilities
- [ ] **Conditionally approved**: Provider meets capabilities with documented mitigations for gaps
- [ ] **Not approved**: Provider does not meet requirements

**Decision rationale:**
```
[Explain provider selection or rejection, key strengths/weaknesses, risk mitigations]
```

**Approvers:**

| Role | Name | Approval | Date |
|------|------|----------|------|
| Technical lead | | ☐ | |
| Operations owner | | ☐ | |
| Security reviewer | | ☐ | |

---

**Template version**: 2026-09-09  
**Protected evidence location**: `[secure operations record system - not Git]`
