# Performance audits

Sprint 8 introduces a repeatable performance pass for the web bundle, Cosmos RU usage, and Azure AI Search latency.

## Bundle budget

The CI pipeline now runs `npm run bundle:check -w web` after the production build.

Current enforced gzip budgets:

- Entry JavaScript: `<= 210000` bytes
- Entry CSS: `<= 15000` bytes
- Async JavaScript: `<= 120000` bytes
- Total JavaScript: `<= 210000` bytes

The budget check reads `web/dist/.vite/manifest.json` and fails the build when any limit is exceeded.

## Cosmos RU audit

The API emits `customMetrics` entries named `cosmos.ru.consumed` for Cosmos reads, writes, patches, deletes, and queries. Each sample includes:

- `endpoint`: the Azure Functions HTTP endpoint name, or `background` for non-HTTP triggers
- `container`: the Cosmos container name
- `operationClass`: `read`, `create`, `upsert`, `patch`, `delete`, `replace`, or `query`

Use this KQL in Application Insights or Log Analytics to find the top 10 RU-heavy endpoints:

```kusto
customMetrics
| where name == "cosmos.ru.consumed"
| extend endpoint = tostring(customDimensions.endpoint)
| extend container = tostring(customDimensions.container)
| extend operationClass = tostring(customDimensions.operationClass)
| summarize totalRu = sum(value), avgRu = avg(value), samples = count() by endpoint, container, operationClass
| summarize totalRu = sum(totalRu), avgRu = avg(avgRu), samples = sum(samples) by endpoint
| top 10 by totalRu desc
```

Use this variant when you need the hot container and operation mix behind a specific endpoint:

```kusto
customMetrics
| where name == "cosmos.ru.consumed"
| extend endpoint = tostring(customDimensions.endpoint)
| extend container = tostring(customDimensions.container)
| extend operationClass = tostring(customDimensions.operationClass)
| summarize totalRu = sum(value), avgRu = avg(value), samples = count() by endpoint, container, operationClass
| order by totalRu desc
```

## Azure AI Search latency audit

The API emits `customMetrics` entries named `search.query.duration_ms` for `posts`, `users`, and `hashtags` Azure AI Search queries. Each sample includes:

- `endpoint`: the Azure Functions HTTP endpoint name, or `background` for non-HTTP triggers
- `searchType`: `posts`, `users`, or `hashtags`

Use this KQL to verify the Sprint 8 p95 target of `< 500 ms`:

```kusto
customMetrics
| where name == "search.query.duration_ms"
| extend endpoint = tostring(customDimensions.endpoint)
| extend searchType = tostring(customDimensions.searchType)
| summarize p95Ms = percentile(value, 95), avgMs = avg(value), samples = count() by endpoint, searchType, bin(timestamp, 1h)
| order by timestamp desc, endpoint asc, searchType asc
```

Use this alert-oriented query to flag regressions:

```kusto
customMetrics
| where name == "search.query.duration_ms"
| extend endpoint = tostring(customDimensions.endpoint)
| summarize p95Ms = percentile(value, 95) by endpoint, bin(timestamp, 5m)
| where p95Ms > 500
```
