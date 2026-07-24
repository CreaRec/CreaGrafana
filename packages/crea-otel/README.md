# `@crearec/otel`

Thin OpenTelemetry bootstrap for CreaRec apps talking to CreaGrafana Alloy (OTLP).
Implements the bot fleet metrics from [docs/telemetry-contract.md](../../docs/telemetry-contract.md).

## Install from GitHub Packages

Configure npm with a GitHub token that has `read:packages` access:

```ini
@crearec:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install the package:

```sh
npm install @crearec/otel
```

GitHub Actions can use its repository `GITHUB_TOKEN`. Local installs need a
personal access token (classic) with `read:packages`; private repository access
may also be required.

## Release

1. Update the version in `package.json` and `package-lock.json`, for example:

```sh
cd packages/crea-otel
npm version 0.2.0 --no-git-tag-version
```

2. Commit and push the version change.
3. Create a GitHub Release with the matching tag, for example
   `otel-v0.2.0`.

Publishing the release runs the package tests and publishes to GitHub Packages.
The workflow's built-in `GITHUB_TOKEN` supplies `packages: write`; no separate
publishing token is needed.

For development in this repository, examples can continue using the local
dependency `"@crearec/otel": "file:../../packages/crea-otel"`.

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
