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

## Local smoke test (optional)

Prefer validating against the **deployed** Alloy on the server. If you temporarily run compose on a laptop for debugging:

```sh
cd examples/node-otel
npm install
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start
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

3. Add OpenTelemetry SDK (or auto-instrumentation) in the app. See `node-otel/` for a minimal Node pattern.

Instrumenting [CreaVideoDownloaderBot](https://github.com/CreaRec/CreaVideoDownloaderBot) itself is a follow-up; this repo only provides the backend and examples.
