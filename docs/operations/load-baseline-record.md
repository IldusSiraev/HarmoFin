# Load Baseline Record

This document records non-destructive load baseline measurements against staging or production. Use to establish performance expectations and detect regressions.

## Baseline metadata

- **Baseline ID**: `[unique identifier]`
- **Measurement date/time**: `[YYYY-MM-DD HH:MM UTC]`
- **Executed by**: `[name]`
- **Environment**: `[staging | production]`
- **Release SHA**: `[commit SHA]`
- **Purpose**: `[initial baseline | pre-release verification | post-deployment check | regression investigation]`

## Environment configuration

- **Base URL**: `[https://environment-domain]`
- **Database**: `[PostgreSQL version, instance size/capacity]`
- **Application**: `[container resource limits, replica count]`
- **Worker**: `[concurrency, poll interval]`
- **Load source**: `[measurement tool, location, network path]`

## Target performance expectations

Based on development specification section 19 (non-functional requirements):

- **Web home page**: < 800ms P95, < 1500ms P99
- **API authentication**: < 400ms P95, < 800ms P99
- **API journal query**: < 600ms P95 (typical filter, ≤100 operations)
- **Worker processing**: Background jobs complete within lease window

## Measurement methodology

### Tools and approach
```
[Document load testing tool, configuration, request patterns]

Example:
- Tool: k6 or Apache Bench or manual browser measurement
- Duration: 5 minutes sustained load
- Concurrency: 10 concurrent users
- Think time: 2 seconds between requests
```

### Test scenarios

1. **Unauthenticated home page load**
   - Target: Public landing page
   - Method: GET /
   - Expected: Static content, no database queries

2. **Authentication flow**
   - Target: Sign-in page and POST authentication
   - Method: GET /sign-in, POST /api/v1/auth/sign-in
   - Expected: Database read for user lookup, session creation

3. **Authenticated journal page**
   - Target: Budget operations list with typical filter
   - Method: GET /budgets/{id}/journal with date range
   - Expected: Database query with ≤100 operations returned

4. **Worker health and job processing**
   - Target: Worker internal health endpoint
   - Method: GET http://worker:3003/internal/health/ready
   - Expected: Worker running, database connected

## Baseline results

### 1. Unauthenticated home page

**Request count**: `[total requests]`  
**Success rate**: `[percentage]`  
**Latency**:
- P50: `[ms]`
- P95: `[ms]` (target: < 800ms)
- P99: `[ms]` (target: < 1500ms)
- Max: `[ms]`

**Error rate**: `[percentage, breakdown by status code if applicable]`

**Notes:**
```
[Observations, CDN behavior, static asset performance]
```

### 2. Authentication flow

**Request count**: `[total requests]`  
**Success rate**: `[percentage]`  
**Latency**:
- P50: `[ms]`
- P95: `[ms]` (target: < 400ms)
- P99: `[ms]` (target: < 800ms)
- Max: `[ms]`

**Error rate**: `[percentage]`

**Notes:**
```
[Session creation performance, database query time, rate limit behavior]
```

### 3. Authenticated journal query

**Request count**: `[total requests]`  
**Success rate**: `[percentage]`  
**Latency**:
- P50: `[ms]`
- P95: `[ms]` (target: < 600ms for ≤100 operations)
- P99: `[ms]`
- Max: `[ms]`

**Query characteristics**:
- Operations returned: `[count]`
- Date range: `[days]`
- Filters applied: `[description]`

**Error rate**: `[percentage]`

**Notes:**
```
[Database query performance, pagination behavior, data volume impact]
```

### 4. Worker health and processing

**Worker status**: `[healthy | degraded | unhealthy]`  
**Job backlog**: `[count]`  
**Poll frequency**: `[interval]`  
**Lease acquisition**: `[success rate]`  
**Job completion rate**: `[percentage]`  
**Job failure rate**: `[percentage]`

**Notes:**
```
[Worker concurrency, database poll latency, job processing latency]
```

## Resource utilization

### Application containers

- **CPU usage**: `[percentage or mCPU]`
- **Memory usage**: `[MB/GB]`
- **Network I/O**: `[MB/s]`

### Database

- **Connection count**: `[count]`
- **CPU usage**: `[percentage]`
- **IOPS**: `[operations/sec]`
- **Query latency**: `[ms average]`
- **Active queries**: `[count]`

### Worker

- **CPU usage**: `[percentage]`
- **Memory usage**: `[MB/GB]`
- **Job queue depth**: `[count]`

## Observability verification

### Logs
- [ ] Request logs appearing in log backend
- [ ] Request IDs present and correlatable
- [ ] No sensitive data in logs (passwords, cookies, financial payloads)
- [ ] Error logs actionable

### Metrics
- [ ] Prometheus metrics endpoint accessible internally
- [ ] HTTP request count/latency/error metrics present
- [ ] Database readiness/latency metrics present
- [ ] Worker job outcome metrics present
- [ ] Release SHA visible in metrics

### Traces
- [ ] Traces appearing in trace backend (if configured)
- [ ] Request correlation working
- [ ] Sensitive data redacted

### Error reporting
- [ ] Errors appearing in error reporting backend (if configured)
- [ ] Stack traces actionable
- [ ] Sensitive data redacted

## Performance assessment

- [ ] **Meets targets**: All P95/P99 latencies within development spec targets
- [ ] **Acceptable**: Minor deviations with documented reasoning
- [ ] **Does not meet targets**: Performance regressions require investigation

**Assessment summary:**
```
[Overall performance evaluation, comparison to targets, identified bottlenecks]

Example:
- Home page P95 480ms: meets target (< 800ms)
- Auth P95 320ms: meets target (< 400ms)
- Journal P95 520ms: meets target (< 600ms)
- Worker processing healthy, no backlog
- Overall: Meets all non-functional requirements for MVP load
```

## Issues and recommendations

**Performance bottlenecks identified:**
```
[Document any slow queries, resource constraints, or optimization opportunities]
```

**Capacity recommendations:**
```
[Recommendations for scaling, resource adjustments, or architectural changes]
```

**Next baseline measurement:**
```
[Recommended timing for next baseline - typically after significant releases]
```

## Approvals

| Role | Name | Reviewed | Date |
|------|------|----------|------|
| Performance owner | | ☐ | |
| Operations owner | | ☐ | |

---

**Template version**: 2026-09-09  
**Protected evidence location**: `[secure operations record system - not Git]`  
**Related documentation**: Development specification section 19
