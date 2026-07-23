# Debian server layout

Production runs CreaGrafana in Docker on the same Debian host as other CreaRec stacks. See [docker.md](docker.md) for bootstrap and Actions.

## Layout

Default deploy directory: `/home/crearec/crea-grafana`

| Path | Role |
|------|------|
| `docker-compose.yml` | Synced from git by Actions |
| `config/` | Synced from git by Actions (Alloy, Loki, Tempo, Mimir, Grafana provisioning) |
| `.env` | Bind addresses, admin password, image tags (never overwritten by Actions) |
| `data/` | Persistent volumes for all backends (never overwritten by Actions) |

Host user: `crearec`. External Docker network: `lgtm` (create once).

## Prerequisites

- Docker Engine + Compose plugin
- `crearec` can run `docker compose` without sudo
- Tailscale on the server; Grafana bound to the Tailscale IP via `GRAFANA_BIND`
- GitHub Actions secrets listed in [docker.md](docker.md)

## GitHub Actions

Push/merge to `main` runs:

1. `test` — `./scripts/test.sh` (config contracts + `docker compose config`)
2. `deploy` — Tailscale → SCP compose + config → `docker compose pull && up -d`

There is no image publish step. Actions never overwrites `.env` or `data/`.

## Networking with bots

- Bots on network `lgtm`: `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318`
- Otherwise on the same host: `http://127.0.0.1:4318`

Grafana UI: `http://<GRAFANA_BIND>:3000` over Tailscale only.
