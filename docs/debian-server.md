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

## Media USB disk monitoring

Host SMART and filesystem metrics for `/dev/sdb` (`/mnt/media-usb`) are collected by `scripts/media-usb-metrics.py` as user `grok` (every 4 minutes via cron) and pushed via OTLP HTTP to `http://127.0.0.1:4318/v1/metrics` (with a local Prometheus textfile copy at `/home/grok/media-usb-metrics/media_usb_disk.prom`).

- Sudoers for `grok` (in `/etc/sudoers.d/grok-smart`): `NOPASSWD: /usr/sbin/smartctl -a /dev/sdb` and `NOPASSWD: /usr/sbin/smartctl -n standby -a /dev/sdb`. The collector prefers `-n standby` (checked via `sudo -n -l`) so a sleeping disk is not spun up; it falls back to `smartctl -a` only if the standby rule is missing.
- In standby the collector still emits `media_usb_disk_present`, `media_usb_mount_present`, `media_usb_disk_standby=1`, and `media_usb_metrics_last_success_timestamp_seconds`. It does **not** emit SMART attributes or filesystem size/free metrics (`statvfs` on ntfs-3g can wake the drive). Alert rules stay quiet: SMART and low-free-space rules use `noDataState: OK`; presence and last-success timestamps keep being updated.
- Dashboard: `config/grafana/dashboards/media-usb-disk.json` (`uid: crea-media-usb-disk`)
- Alert rules: `config/grafana/provisioning/alerting/media-usb-disk.yaml` (label `disk=media-usb`)
- Telegram notifications: `config/grafana/provisioning/alerting/telegram.yaml` — contact point `telegram` (`@crea_alerts_bot`) is the only notifier. The provisioned policy tree uses it as the root receiver and as the child route for `disk=media-usb`. Provisioning a policy tree replaces the whole tree.
- **Required before deploy:** set the following in `/home/crearec/crea-grafana/.env` (Actions never overwrites `.env`). Grafana 11.5.2 validates the Telegram bot token at startup and **will fail to start** if `GF_TELEGRAM_BOT_TOKEN` is empty:
  ```
  GF_TELEGRAM_BOT_TOKEN=<token>
  GF_TELEGRAM_CHAT_ID=<chat-id>
  ```
  Merge to `main` only after `.env` is updated, or Grafana will not come up.
