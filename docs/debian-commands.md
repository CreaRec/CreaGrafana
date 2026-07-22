# Debian / Docker operations

Useful commands for the CreaGrafana stack on the Debian server.

Deploy directory (default): `/home/crearec/crea-grafana`

Releases are deployed by GitHub Actions on `main`. You can also use Portainer for the same containers.

## Container control

```sh
cd /home/crearec/crea-grafana
docker compose ps
docker compose logs -f
docker compose logs --tail=100 alloy
docker compose logs --tail=100 grafana
docker compose logs --tail=50 listen-ports
docker compose restart
docker compose stop
docker compose up -d
```

## Host listen ports

Sidecar `listen-ports` runs `ss -tulpn` every 15s into `data/listen-ports/` (Prometheus textfile). Alloy scrapes that file into Mimir. Dashboard: **CreaGrafana → Host listen ports**.

```sh
docker compose ps listen-ports alloy
docker compose logs --tail=50 listen-ports
ls -la data/listen-ports/
# Explore (Mimir): host_socket_listen
```

Needs `network_mode: host`, `pid: host`, `SYS_PTRACE`, and `apparmor:unconfined` for process names in `ss -p`.

## Config changes

Compose and `config/` are owned by git/Actions. Prefer changing them in the repo.

For `.env` only (password, `GRAFANA_BIND`):

```sh
cd /home/crearec/crea-grafana
nano .env
docker compose up -d
```

## Disk / data

```sh
du -sh data/*
docker system df
```

## Troubleshooting

```sh
docker compose ps
docker network inspect lgtm
docker compose logs --tail=100 alloy loki tempo mimir grafana listen-ports
```

Compose fails with “network lgtm declared as external but could not be found”:

```sh
docker network create lgtm
docker compose up -d
```

Cannot open Grafana from your laptop: confirm you are on Tailscale, `GRAFANA_BIND` is the server’s Tailscale IP (not `0.0.0.0` / public NIC), and ACLs allow TCP 3000.

Missing `.env` causes the Actions deploy step to fail with an explicit error — bootstrap `.env` once (see [docker.md](docker.md)).
