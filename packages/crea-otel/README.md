# `@crearec/otel`

Thin OpenTelemetry bootstrap for CreaRec apps talking to CreaGrafana Alloy (OTLP).
Implements the bot fleet metrics from [docs/telemetry-contract.md](../../docs/telemetry-contract.md).

## Install (this repo)

Not published to npm yet. From another package in a checkout:

```sh
cd packages/crea-otel && npm install && npm run build
```

Consume from an example / bot via local path:

```json
{
  "dependencies": {
    "@crearec/otel": "file:../../packages/crea-otel"
  }
}
```

Or pack once:

```sh
cd packages/crea-otel && npm pack
# install the resulting .tgz in the bot
```

npm registry / GitHub Packages publish is a follow-up.

## Config

Explicit fields override env:

| Field | Env | Required |
|-------|-----|----------|
| `serviceName` | `OTEL_SERVICE_NAME` | yes |
| `serviceNamespace` | `OTEL_SERVICE_NAMESPACE` | yes |
| `deploymentEnvironment` | `DEPLOY_ENV` | no (default `local`) |
| `serviceVersion` | `OTEL_SERVICE_VERSION` | no |
| `endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | no (default `http://127.0.0.1:4318`) |
| `kind` | — | no (`app` \| `bot`, default `app`) |

## App

```js
const { initTelemetry } = require("@crearec/otel");

const tel = initTelemetry({
  kind: "app",
  serviceName: "crea-media-api",
  serviceNamespace: "media",
  endpoint: "http://alloy:4318",
});

const counter = tel.meter.createCounter("requests_total");
counter.add(1, { route: "/health" });

await tel.shutdown();
```

## Bot

Emits `bot_updates_total`, `bot_handler_duration_seconds`, `bot_errors_total`, `bot_up`.
`recordHandledUpdate` always records the histogram and increments the counter together.

```js
const { initTelemetry } = require("@crearec/otel");

const tel = initTelemetry({
  kind: "bot",
  serviceName: "crea-video-downloader",
  serviceNamespace: "bots",
});

tel.bot.setUp(true);

const started = process.hrtime.bigint();
// ... handle update ...
const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;

tel.bot.recordHandledUpdate({
  result: "success",
  durationSeconds,
  handler: "download",
});

// on application failure:
tel.bot.recordError({ errorType: "timeout", handler: "download" });
tel.bot.recordHandledUpdate({
  result: "error",
  durationSeconds,
  handler: "download",
});

await tel.shutdown();
```

## Notes

- Export failures must not crash business logic; shutdown logs warnings.
- Do not put high-cardinality labels on metrics (user ids, URLs, paths).
- Duration unit is **seconds**, matching `bot_handler_duration_seconds`.
