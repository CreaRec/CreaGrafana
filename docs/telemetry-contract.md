# Telemetry contract (bots, MCP servers, and services)

Shared scheme for all CreaRec apps that send OpenTelemetry to CreaGrafana Alloy.
Follow this so fleet / detail dashboards and Explore queries work across bots and MCP servers.

Apps talk **only** to Alloy (OTLP). Do not send to Loki, Tempo, or Mimir directly.
See [examples/README.md](../examples/README.md) for endpoints and Docker network `lgtm`.

For Node/TypeScript apps, bots, and MCP servers, prefer [`@crearec/otel`](../packages/crea-otel) (`initTelemetry` with `kind: "app"`, `kind: "bot"`, or `kind: "mcp"`). The bot helpers emit `bot_updates_total` and `bot_handler_duration_seconds` together; MCP helpers emit `mcp_tool_calls_total` and `mcp_tool_duration_seconds` together — fleet dashboards stay consistent.

## Resource attributes (required)

Set on the OTEL `Resource` (or via env where supported):

| Attribute | Example | Rules |
|-----------|---------|--------|
| `service.name` | `crea-video-downloader` | Stable id; kebab-case; **no** version in the name |
| `service.namespace` | `bots`, `mcp` | Group: `bots`, `mcp`, `media`, … |
| `service.version` | `sha-abc1234` or image tag | Optional but recommended |
| `deployment.environment` | `production` | `production` / `staging` / `local`. (OTel semconv also documents `deployment.environment.name`; prefer this contract name so Prometheus gets `deployment_environment`.) |

Env mapping used by our stacks:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318   # from containers on network lgtm
OTEL_SERVICE_NAME=crea-video-downloader
OTEL_SERVICE_NAMESPACE=bots
```

For MCP servers, use `service.namespace=mcp` and `service.name` as the server id (kebab-case, e.g. `apple-calendar`).

## Label / attribute cardinality rules

**Allowed on metrics (low cardinality):**

- `result`: `success` | `error` | `skipped`
- `handler`: short enum (`download`, `files`, `restart`, …)
- `error_type`: short enum (`timeout`, `telegram`, `openai`, `fs`, `unknown`, …)

**Never use as metric labels** (put in span attributes or log body instead):

- Telegram `user_id`, `chat_id`, `message_id`
- CalDAV/Apple uid, href, raw ICS content
- Passwords, emails, tokens, free-text notes
- Raw URLs (especially with secrets), captions, filenames, full filesystem paths
- Free-text error messages
- Request/trace ids as labels (use trace context, not series)

Truncated safe summaries belong on **log attributes only**, not metric labels or Loki stream labels.

Metric names: `snake_case`, Prometheus-style suffixes (`_total`, `_seconds`).

## Required metrics (all bots)

Prefix `bot_` so fleet dashboards can use one query. These are what **Services fleet** / **Service detail** query for bots — emit all of them. Host apps (e.g. phone agent under `service.namespace=apps`) use app-specific metrics (`phone_unlocks_total`, `phone_unlock_duration_seconds`, `phone_errors_total`); the same dashboards OR those with `bot_*` by selected namespace/service.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `bot_updates_total` | counter | `result` | Inbound Telegram updates handled |
| `bot_handler_duration_seconds` | histogram | optional `handler`, `result` | Handler latency |
| `bot_errors_total` | counter | optional `error_type`, `handler` | Explicit application errors |
| `bot_up` | gauge | — | `1` while the process is healthy |

### Emit counter and histogram together

Services fleet / Service detail **Successful requests** and **Request rate** for bots come from `bot_updates_total`. **Latency (p50/p95)** comes from `bot_handler_duration_seconds`. They are independent series in Mimir.

**On every handled update (success, error, or skipped), in the same code path:**

1. Record `bot_handler_duration_seconds` (unit: **seconds**, not milliseconds).
2. Increment `bot_updates_total` with the same `result` (`success` | `error` | `skipped`).
3. On application failure, also increment `bot_errors_total` when appropriate.

Do **not** record the histogram alone. That makes latency panels look live while Successful requests / rate stay at `0` — a real failure mode we hit when only duration was instrumented.

Keep one series family for `bot_updates_total`: required label is `result` only. Optional low-cardinality labels (`handler`) are fine; avoid emitting a second parallel counter series that differs only by an extra label (e.g. sometimes with `update_kind`, sometimes without) — dashboards `sum`/`increase` then become hard to reason about.

Histogram bucket boundaries must match **seconds** (e.g. `0.005` … `10`), not millisecond integers (`5`, `100`, `2500`, …). Wrong units make p50/p95 look like multi-second values when the handler was actually milliseconds (or the reverse).

### How to verify after a fix

In Explore (Mimir), same time range, after traffic:

```promql
increase(bot_updates_total{job=~".*crea-trip-planner.*", result="success"}[15m])
```

```promql
increase(bot_handler_duration_seconds_count{job=~".*crea-trip-planner.*"}[15m])
```

Both must move together (same order of magnitude of events). If `_count` grows and `bot_updates_total` stays flat, the counter is still missing on that path.

Label note: until Alloy copies resource attrs onto datapoints, series may appear under `job="bots/<service.name>"` without `service_name`. Prefer still setting resource attrs; dashboards have a `job` fallback. After Alloy `resource_labels`, filter on `service_name` / `deployment_environment` as in the tables above.

## Required metrics (MCP servers)

Prefix `mcp_` so fleet dashboards can isolate MCP servers from `bot_*` and app-specific metrics.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `mcp_tool_calls_total` | counter | `result`, optional `tool` | Tool invocations handled |
| `mcp_tool_duration_seconds` | histogram | optional `result`, `tool` | Tool latency |
| `mcp_errors_total` | counter | optional `error_type`, `tool` | Explicit application errors |
| `mcp_up` | gauge | — | `1` while the server is healthy |

Label values:

- `result`: `success` | `error` | `skipped`
- `tool`: low-cardinality tool name (e.g. `calendar_list`, `calendar_create_event`)
- `error_type`: short enum (`timeout`, `caldav`, `auth`, `unknown`, …)

### Emit counter and histogram together (MCP)

Same rule as bots. **On every tool call (success, error, or skipped), in the same code path:**

1. Record `mcp_tool_duration_seconds` (unit: **seconds**, not milliseconds).
2. Increment `mcp_tool_calls_total` with the same `result` (`success` | `error` | `skipped`).
3. On application failure, also increment `mcp_errors_total` when appropriate.

Do **not** record the histogram alone.

Histogram bucket boundaries must match **seconds** (e.g. `0.005` … `10`), same style as bot metrics.

### How to verify (MCP)

In Explore (Mimir), same time range, after traffic:

```promql
{service_namespace="mcp", service_name="apple-calendar"}
```

```promql
increase(mcp_tool_calls_total{service_namespace="mcp", service_name="apple-calendar", result="success"}[15m])
```

```promql
increase(mcp_tool_duration_seconds_count{service_namespace="mcp", service_name="apple-calendar"}[15m])
```

Both counter and histogram count must move together.

## Traces (recommended names)

| Span name | When |
|-----------|------|
| `bot.handle_update` | Root span per Telegram update |
| `mcp.tool_call` | Root span per MCP tool invocation |

Span **attributes** (OK to be higher detail than metric labels): `result`, `error.type`, `tool`, sizes. Still avoid putting raw PII in attributes if logs are retained long-term.

On failure: `span.recordException(err)` and set span status to error.

Propagate `trace_id` into logs so Loki ↔ Tempo links work.

## Logs

- Keep existing console logging if you have it.
- Also emit **OTEL logs** (Loki native OTLP via Alloy). Console-only lines without OTEL severity will not appear in Error / Warning dashboard panels.
- Set OTEL `severityText` (and preferably `severityNumber`) on every log record. Required values (case-insensitive; prefer uppercase):

  | `severityText` | Use for |
  |----------------|---------|
  | `DEBUG` / `INFO` | Normal operation |
  | `WARN` | Recoverable / degraded (also accept `WARNING`) |
  | `ERROR` | Failures that need attention (also accept `FATAL`) |

- Prefer structured attributes: `handler`, `result`, `error_type`, `tool`, `duration_ms`. Propagate `trace_id` so Loki ↔ Tempo links work.
- Do **not** rely on wording in the log body (`"error"`, `"fail"`, …) for severity — dashboards filter on `severity_text`, not text heuristics.
- Do not turn high-cardinality fields into Loki **stream labels**; keep streams based on `service_name` / `service_namespace`. Severity stays structured metadata (`severity_text`) from OTLP — fine to filter in LogQL, do not promote free-text messages to labels.

Fleet / detail dashboards:

```logql
{service_namespace="bots", service_name=~".+"} | severity_text=~"(?i)error|fatal"
```

```logql
{service_namespace="bots", service_name=~".+"} | severity_text=~"(?i)warn"
```

## Grafana checks

After deploy, Explore (time range last 15m):

```logql
{service_name="crea-video-downloader"}
```

```logql
{service_name="crea-video-downloader"} | severity_text=~"(?i)error|fatal"
```

```promql
sum by (service_name) (rate(bot_updates_total[5m]))
```

```promql
sum by (service_name) (rate(bot_errors_total[5m]))
```

```promql
max by (service_name) (bot_up)
```

Tempo: search `service.name = crea-video-downloader` (or your bot’s `service.name`).

Fleet-wide (all bots in namespace):

```promql
sum by (service_name) (rate(bot_updates_total{service_namespace="bots"}[5m]))
```

Fleet-wide (all MCP servers in namespace):

```promql
sum by (service_name) (rate(mcp_tool_calls_total{service_namespace="mcp"}[5m]))
```

```promql
sum by (service_name) (rate(mcp_errors_total{service_namespace="mcp"}[5m]))
```

```promql
max by (service_name) (mcp_up{service_namespace="mcp"})
```

(Exact PromQL label names may appear as `service_name` after OTEL→Prometheus translation; adjust if your export uses dots.)

## What apps must not do

- Point OTLP at Loki/Tempo/Mimir URLs
- Block business logic if export fails (warn and continue)
- Invent parallel metric names for the same idea (`requests_total` vs `bot_updates_total` — prefer the contract)
- Record `bot_handler_duration_seconds` without incrementing `bot_updates_total` on the same handle
- Record `mcp_tool_duration_seconds` without incrementing `mcp_tool_calls_total` on the same tool call
- Observe the histogram in milliseconds while the metric name/unit is `_seconds`
- Put CalDAV/Apple uid, href, raw ICS, passwords, emails, tokens, or full URLs with secrets in metric labels or Loki stream labels

## Versioning this contract

Breaking renames of required metrics need a short note here and a dashboard update.
Additive optional labels on required metrics are fine without a version bump.
