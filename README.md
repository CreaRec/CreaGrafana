# CreaGrafana (LGTM)

Self-hosted observability for CreaRec bots and projects: **Loki** (logs), **Grafana** (UI), **Tempo** (traces), **Mimir** (metrics), with **Alloy** as the OTLP collector.

Apps send OpenTelemetry to Alloy. Grafana is private (Tailscale bind in production). Deploy mirrors [CreaVideoDownloaderBot](https://github.com/CreaRec/CreaVideoDownloaderBot): thin server directory, Docker Compose, GitHub Actions over Tailscale — without a custom GHCR image (official `grafana/*` images only).

## Deploy (intended path)

Production is the Debian host shared with your bots. Grafana binds to your Tailscale IP only. Do not rely on a local Mac stack for “prod.”

1. One-time server bootstrap — [docs/docker.md](docs/docker.md)
2. Push to `main` — Actions runs `test` (`./scripts/test.sh`) then deploys compose + `config/`
3. Open Grafana at `http://<GRAFANA_BIND>:3000` over Tailscale
4. Smoke-test OTLP with [examples/node-otel](examples/node-otel) pointed at the server Alloy endpoint (or from another host on Tailscale / the server itself)

Also:

- [docs/debian-server.md](docs/debian-server.md) — deploy directory layout
- [docs/debian-commands.md](docs/debian-commands.md) — day-to-day `docker compose` / Portainer
- [docs/tuning.md](docs/tuning.md) — retention, cardinality, Alloy batching
- [docs/telemetry-contract.md](docs/telemetry-contract.md) — shared metrics/traces/logs scheme for all bots
- [examples/README.md](examples/README.md) — app wiring and Explore queries

## Layout

| Path | Role |
|------|------|
| `docker-compose.yml` | Alloy, Loki, Tempo, Mimir, Grafana |
| `config/` | Backend + Grafana provisioning |
| `scripts/test.sh` | CI/local config + compose checks |
| `examples/` | How apps should export OTLP |
| `.env` (server only) | Bind addresses, admin password, image tags |
| `data/` | Persistent storage (gitignored) |
