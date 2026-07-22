# What to tune

Start with the defaults in this repo. Change these when something hurts (disk, cardinality, lag, noise).

## Retention (disk)

| Component | Default in repo | File / knob |
|-----------|-----------------|-------------|
| Loki | 14d (`336h`) | `config/loki/loki.yaml` → `limits_config.retention_period` |
| Tempo | 7d (`168h`) | `config/tempo/tempo.yaml` → `compactor.compaction.block_retention` |
| Mimir | 14d (`336h`) | `config/mimir/mimir.yaml` → `limits.compactor_blocks_retention_period` |

Watch `du -sh data/*` on the server. Shorten retention before buying more disk.

## Alloy batching

`config/alloy/config.alloy` → `otelcol.processor.batch`:

- Raise `timeout` / `send_batch_size` if you have high volume and want fewer small writes.
- Lower them if you need lower latency for demos.

## Cardinality (Mimir)

Bad labels explode series count: raw URLs, Telegram user IDs, message IDs, full file paths.

Prefer:

- `service.name`, `service.namespace`, `deployment.environment`
- Low-cardinality enums (`http.status_code`, `error.type`)

Hard limits live under `limits` in `config/mimir/mimir.yaml` (`max_global_series_per_user`, `ingestion_rate`). Raise only when you understand why series grow.

## Resource attributes (apps)

Every app should set:

```text
service.name        = stable app id (crea-video-downloader)
service.namespace   = project group (bots, media, …)
```

Use the same values in LogQL / TraceQL / PromQL filters. See [examples/README.md](../examples/README.md).

## Grafana access

- Local: `GRAFANA_BIND=127.0.0.1`
- Production: Tailscale IP only; rotate `GF_SECURITY_ADMIN_PASSWORD` in server `.env`
- Optional: tighten Tailscale ACLs to your user/device for TCP 3000

## Image pins

Bump tags in `.env` (`GRAFANA_IMAGE`, `LOKI_IMAGE`, …) deliberately, then deploy. Prefer not using `latest` on the server.

## When to leave filesystem storage

Filesystem backends are fine for a **single replica** on one host. Plan MinIO/S3 (or similar) when you need:

- HA / multiple Mimir or Loki replicas
- Shared durable storage across hosts
- Retention much larger than local disk comfortably holds

That migration is out of scope for this first setup.
