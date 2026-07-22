# Docker + Tailscale deployment

CreaGrafana runs as Docker Compose on the same Debian host as your bots. Releases sync **compose + config** from git via GitHub Actions on `main`. There is no custom GHCR image and no local deploy script.

Upstream images: `grafana/alloy`, `grafana/loki`, `grafana/tempo`, `grafana/mimir`, `grafana/grafana` (tags pinned in `.env`). Host listen-ports uses `alpine` (see `LISTEN_PORTS_IMAGE`) with `network_mode: host`, `pid: host`, `SYS_PTRACE`, `apparmor:unconfined`, and `/var/run/docker.sock` (ro) so `ss -tlnp` lists TCP LISTEN ports (for free-port picking) with process names and Docker `container` + Compose `compose_service`.

## How a release works

1. Merge or push to `main`.
2. Actions validates `docker compose config`.
3. Actions joins Tailscale (`tag:ci`), SCPs `docker-compose.yml` and `config/` to the server, then runs `docker compose pull && docker compose up -d`.

Secrets and bind addresses stay on the server in `.env`. Data under `data/` is never overwritten by Actions.

## One-time server bootstrap

Use the same Linux user that runs Docker/Portainer (`crearec`).

### 1. Deploy directory

Default path: `/home/crearec/crea-grafana`

```sh
mkdir -p /home/crearec/crea-grafana/data/{alloy,loki,tempo,mimir,grafana,listen-ports}
cd /home/crearec/crea-grafana
docker network create lgtm 2>/dev/null || true
```

Copy `docker-compose.yml` and `config/` from the repo once (Actions will refresh them on later deploys).

### 2. Create `.env`

```sh
cp /path/to/checkout/.env.example .env
```

Set at least:

```sh
# Your Tailscale IP (ip addr show tailscale0) — do not use 0.0.0.0
GRAFANA_BIND=100.x.x.x
ALLOY_UI_BIND=100.x.x.x

GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD='pick-a-strong-password'

GF_SERVER_ROOT_URL=http://100.x.x.x:3000
```

OTLP ports `4317`/`4318` are published on all interfaces so other containers on the host can use `127.0.0.1:4318`. Prefer attaching bots to the external Docker network `lgtm` and using `http://alloy:4318` (see [examples/README.md](../examples/README.md)).

### 3. First start

```sh
cd /home/crearec/crea-grafana
docker compose pull
docker compose up -d
docker compose ps
```

Or merge to `main` and let Actions deploy after `.env` and `data/` exist.

Open Grafana at `http://<GRAFANA_BIND>:3000` from a device on your Tailscale network. Restrict Tailscale ACLs so only you (or your admin group) can reach TCP 3000 on that host.

### 4. Portainer

You can manage the same stack in Portainer. Prefer not editing compose by hand in Portainer if Actions owns the files — change configs in git.

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_SSH_KEY` | Private key for SSH deploy |
| `DEPLOY_HOST` | Tailscale IP or MagicDNS hostname of the server |
| `DEPLOY_USER` | SSH user (for example `crearec`) |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (Trust credentials) for ephemeral CI nodes |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret |

Deploy joins the tailnet with `tag:ci` via [`tailscale/github-action`](https://github.com/tailscale/github-action), then SSHs to `DEPLOY_HOST`. Create the OAuth client under Tailscale **Settings → Trust credentials**.

## Day-to-day

Deploy: merge to `main`.

On the server:

```sh
cd /home/crearec/crea-grafana
docker compose ps
docker compose logs -f
docker compose restart
```

After editing `.env` (password, bind IP), recreate:

```sh
docker compose up -d
```
