#!/usr/bin/env bash
# Config/contract checks for CreaGrafana (run locally or from CI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> required files"
test -f docker-compose.yml
test -f config/alloy/config.alloy
test -f config/loki/loki.yaml
test -f config/tempo/tempo.yaml
test -f config/mimir/mimir.yaml
test -f config/grafana/provisioning/datasources/datasources.yaml
test -f config/grafana/provisioning/dashboards/dashboards.yaml
test -f config/grafana/dashboards/host-listen-ports.json
test -f config/grafana/dashboards/bots-fleet.json
test -f config/grafana/dashboards/bot-detail.json
test -f config/listen-ports/export.sh
test -f .env.example

echo "==> alloy contracts"
grep -q 'otelcol.processor.transform "resource_labels"' config/alloy/config.alloy
grep -q 'attributes\["service_name"\]' config/alloy/config.alloy
grep -q 'deployment.environment.name' config/alloy/config.alloy
grep -qE 'add_metric_suffixes[[:space:]]*=[[:space:]]*false' config/alloy/config.alloy
! grep -q 'resource_to_telemetry_conversion = true' config/alloy/config.alloy

echo "==> dashboard contracts"
grep -q 'label_values(bot_updates_total, job)' config/grafana/dashboards/bot-detail.json
grep -q 'severity_text=~\\"(?i)error|fatal\\"' config/grafana/dashboards/bots-fleet.json
grep -q 'severity_text=~\\"(?i)warn\\"' config/grafana/dashboards/bots-fleet.json
grep -q 'severity_text=~\\"(?i)error|fatal\\"' config/grafana/dashboards/bot-detail.json
grep -q 'severity_text=~\\"(?i)warn\\"' config/grafana/dashboards/bot-detail.json
! grep -q 'error|exception|fail' \
  config/grafana/dashboards/bots-fleet.json \
  config/grafana/dashboards/bot-detail.json

echo "==> telemetry contract docs"
grep -q 'severityText' docs/telemetry-contract.md
grep -q 'severity_text' docs/telemetry-contract.md

echo "==> dashboard JSON + log panels"
python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' \
  config/grafana/dashboards/bots-fleet.json \
  config/grafana/dashboards/bot-detail.json
python3 <<'PY'
import json
for p in (
  "config/grafana/dashboards/bots-fleet.json",
  "config/grafana/dashboards/bot-detail.json",
):
  titles = {panel["title"] for panel in json.load(open(p))["panels"]}
  assert "Error logs" in titles and "Warning logs" in titles, p
PY

echo "==> listen-ports script syntax"
sh -n config/listen-ports/export.sh

echo "==> docker compose config"
docker network create lgtm 2>/dev/null || true
cp .env.example .env
docker compose config -q

echo "OK"
