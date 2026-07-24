# App instrumentation examples

Point every bot and project at Alloy (OTLP). Do not send directly to Loki, Tempo, or Mimir.

## Endpoints

| Where the app runs | OTLP HTTP | OTLP gRPC |
|--------------------|-----------|-----------|
| Same Docker host, on network `lgtm` | `http://alloy:4318` | `alloy:4317` |
| Same host, not on `lgtm` | `http://127.0.0.1:4318` | `127.0.0.1:4317` |
| Your Mac (local stack) | `http://127.0.0.1:4318` | `127.0.0.1:4317` |

Set at least:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
export OTEL_SERVICE_NAME=crea-video-downloader
export OTEL_SERVICE_NAMESPACE=bots
```

Use stable `service.name` / `service.namespace` values. Filter by them in Grafana Explore and dashboards. Avoid high-cardinality labels (raw URLs, user IDs, message IDs).

**Metric and span names for bots:** follow the shared scheme in [docs/telemetry-contract.md](../docs/telemetry-contract.md) (`bot_updates_total`, `bot_errors_total`, `bot_handler_duration_seconds`, `bot_up`, …). Prefer [@crearec/otel](../packages/crea-otel) (`kind: "bot"`) so counter + histogram are always emitted together.

## Local smoke test (optional)

Prefer validating against the **deployed** Alloy on the server. Build the shared package once, then run an example:

```sh
cd packages/crea-otel && npm install && npm run build
cd ../../examples/node-otel
npm install
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start
```

Bot-contract smoke (`bot_*` metrics):

```sh
cd packages/crea-otel && npm install && npm run build
cd ../../examples/node-otel-bot
npm install
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_SERVICE_NAME=crea-grafana-bot-example \
OTEL_SERVICE_NAMESPACE=bots \
npm start
```

Against the server (from the Debian host, or any machine that can reach Alloy):

```sh
cd examples/node-otel
npm install
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_SERVICE_NAME=crea-grafana-example \
OTEL_SERVICE_NAMESPACE=examples \
npm start
```

Then in Grafana Explore (Tailscale UI):

- **Loki:** `{service_name="crea-grafana-example"}`
- **Tempo:** Search `service.name=crea-grafana-example`
- **Mimir:** `example_requests_total` or `traces_spanmetrics_calls_total`
- **Bot smoke:** `bot_updates_total`, `bot_handler_duration_seconds`, `bot_up` for `crea-grafana-bot-example`

## Wire another compose stack (e.g. a bot)

1. Ensure external network exists: `docker network create lgtm` (CreaGrafana compose also expects it).
2. In the bot `docker-compose.yml`:

```yaml
services:
  bot:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4318
      OTEL_SERVICE_NAME: crea-video-downloader
      OTEL_SERVICE_NAMESPACE: bots
    networks:
      - default
      - lgtm

networks:
  lgtm:
    external: true
```

3. Add OpenTelemetry via [`@crearec/otel`](../packages/crea-otel) (`initTelemetry`) or raw SDK. See `node-otel/` (app) and `node-otel-bot/` (bot contract).

Instrumenting [CreaVideoDownloaderBot](https://github.com/CreaRec/CreaVideoDownloaderBot) itself is a follow-up; this repo provides the backend, shared Node helper, and examples.
