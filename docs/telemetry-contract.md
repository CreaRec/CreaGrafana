# Telemetry contract (bots and services)

Shared scheme for all CreaRec apps that send OpenTelemetry to CreaGrafana Alloy.
Follow this so fleet / detail dashboards and Explore queries work across bots.

Apps talk **only** to Alloy (OTLP). Do not send to Loki, Tempo, or Mimir directly.
See [examples/README.md](../examples/README.md) for endpoints and Docker network `lgtm`.

## Resource attributes (required)

Set on the OTEL `Resource` (or via env where supported):

| Attribute | Example | Rules |
|-----------|---------|--------|
| `service.name` | `crea-video-downloader` | Stable id; kebab-case; **no** version in the name |
| `service.namespace` | `bots` | Group: `bots`, `media`, … |
| `service.version` | `sha-abc1234` or image tag | Optional but recommended |
| `deployment.environment` | `production` | `production` / `staging` / `local`. (OTel semconv also documents `deployment.environment.name`; prefer this contract name so Prometheus gets `deployment_environment`.) |

Env mapping used by our stacks:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318   # from containers on network lgtm
OTEL_SERVICE_NAME=crea-video-downloader
OTEL_SERVICE_NAMESPACE=bots
```

## Label / attribute cardinality rules

**Allowed on metrics (low cardinality):**

- `result`: `success` | `error` | `skipped`
- `handler`: short enum (`download`, `files`, `restart`, …)
- `error_type`: short enum (`timeout`, `telegram`, `openai`, `fs`, `unknown`, …)

**Never use as metric labels** (put in span attributes or log body instead):

- Telegram `user_id`, `chat_id`, `message_id`
- Raw URLs, captions, filenames, full filesystem paths
- Free-text error messages
- Request/trace ids as labels (use trace context, not series)

Metric names: `snake_case`, Prometheus-style suffixes (`_total`, `_seconds`).

## Required metrics (all bots)

Prefix `bot_` so fleet dashboards can use one query. These are what **Bots fleet** / **Bot detail** query — emit all of them.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `bot_updates_total` | counter | `result` | Inbound Telegram updates handled |
| `bot_handler_duration_seconds` | histogram | optional `handler`, `result` | Handler latency |
| `bot_errors_total` | counter | optional `error_type`, `handler` | Explicit application errors |
| `bot_up` | gauge | — | `1` while the process is healthy |

## Traces (recommended names)

| Span name | When |
|-----------|------|
| `bot.handle_update` | Root span per Telegram update |

Span **attributes** (OK to be higher detail than metric labels): `result`, `error.type`, sizes. Still avoid putting raw PII in attributes if logs are retained long-term.

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

- Prefer structured attributes: `handler`, `result`, `error_type`. Propagate `trace_id` so Loki ↔ Tempo links work.
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

(Exact PromQL label names may appear as `service_name` after OTEL→Prometheus translation; adjust if your export uses dots.)

## What apps must not do

- Point OTLP at Loki/Tempo/Mimir URLs
- Block business logic if export fails (warn and continue)
- Invent parallel metric names for the same idea (`requests_total` vs `bot_updates_total` — prefer the contract)

## Versioning this contract

Breaking renames of required metrics need a short note here and a dashboard update.
Additive optional labels on required metrics are fine without a version bump.
