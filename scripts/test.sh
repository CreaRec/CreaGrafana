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
test -f config/grafana/dashboards/media-usb-disk.json
test -f config/grafana/provisioning/alerting/media-usb-disk.yaml
test -f config/grafana/provisioning/alerting/telegram.yaml
test -f scripts/media-usb-metrics.py
test -f config/grafana/dashboards/services-fleet.json
test -f config/grafana/dashboards/service-detail.json
test ! -e config/grafana/dashboards/bots-fleet.json
test ! -e config/grafana/dashboards/bot-detail.json
test ! -e config/grafana/dashboards/apps-phone-agent.json
test -f config/listen-ports/export.sh
test -f .env.example

echo "==> alloy contracts"
grep -q 'otelcol.processor.transform "resource_labels"' config/alloy/config.alloy
grep -q 'attributes\["service_name"\]' config/alloy/config.alloy
grep -q 'deployment.environment.name' config/alloy/config.alloy
grep -qE 'add_metric_suffixes[[:space:]]*=[[:space:]]*false' config/alloy/config.alloy
! grep -q 'resource_to_telemetry_conversion = true' config/alloy/config.alloy

echo "==> dashboard provisioning"
grep -qE 'allowUiUpdates:[[:space:]]*false' config/grafana/provisioning/dashboards/dashboards.yaml

echo "==> dashboard contracts"
grep -q 'label_values(service_namespace)' config/grafana/dashboards/services-fleet.json
grep -q 'label_values(service_namespace)' config/grafana/dashboards/service-detail.json
grep -q 'label_values({service_namespace=\\"\$namespace\\"}, service_name)' \
  config/grafana/dashboards/services-fleet.json
grep -q 'label_values({service_namespace=\\"\$namespace\\"}, service_name)' \
  config/grafana/dashboards/service-detail.json
grep -q 'bot_errors_total' config/grafana/dashboards/services-fleet.json
grep -q 'bot_errors_total' config/grafana/dashboards/service-detail.json
grep -q 'phone_unlocks_total' config/grafana/dashboards/services-fleet.json
grep -q 'phone_unlocks_total' config/grafana/dashboards/service-detail.json
grep -q 'phone_errors_total' config/grafana/dashboards/services-fleet.json
grep -q 'phone_unlock_duration_seconds_bucket' config/grafana/dashboards/services-fleet.json
grep -q 'phone_unlock_duration_seconds_bucket' config/grafana/dashboards/service-detail.json
grep -q 'crea-bots-fleet' config/grafana/dashboards/services-fleet.json
grep -q 'crea-bot-detail' config/grafana/dashboards/service-detail.json
grep -q 'severity_text=~\\"(?i)error|fatal\\"' config/grafana/dashboards/services-fleet.json
grep -q 'severity_text=~\\"(?i)warn\\"' config/grafana/dashboards/services-fleet.json
grep -q 'severity_text=~\\"(?i)error|fatal\\"' config/grafana/dashboards/service-detail.json
grep -q 'severity_text=~\\"(?i)warn\\"' config/grafana/dashboards/service-detail.json
! grep -q 'error|exception|fail' \
  config/grafana/dashboards/services-fleet.json \
  config/grafana/dashboards/service-detail.json \
  config/grafana/dashboards/media-usb-disk.json
! grep -q '"type": "custom"' \
  config/grafana/dashboards/services-fleet.json \
  config/grafana/dashboards/service-detail.json

echo "==> telemetry contract docs"
grep -q 'severityText' docs/telemetry-contract.md
grep -q 'severity_text' docs/telemetry-contract.md
grep -q '| `bot_updates_total`' docs/telemetry-contract.md
grep -q '| `bot_errors_total`' docs/telemetry-contract.md
grep -q '| `bot_handler_duration_seconds`' docs/telemetry-contract.md
grep -q '| `bot_up`' docs/telemetry-contract.md
grep -q 'Emit counter and histogram together' docs/telemetry-contract.md
grep -q 'Do \*\*not\*\* record the histogram alone' docs/telemetry-contract.md
grep -q 'bot_handler_duration_seconds_count' docs/telemetry-contract.md
grep -q 'Services fleet' docs/telemetry-contract.md
grep -q 'phone_unlocks_total' docs/telemetry-contract.md

echo "==> dashboard JSON + log panels"
python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' \
  config/grafana/dashboards/services-fleet.json \
  config/grafana/dashboards/service-detail.json \
  config/grafana/dashboards/media-usb-disk.json
python3 <<'PY'
import json
for p in (
  "config/grafana/dashboards/services-fleet.json",
  "config/grafana/dashboards/service-detail.json",
):
  titles = {panel["title"] for panel in json.load(open(p))["panels"]}
  assert "Error logs" in titles and "Warning logs" in titles, p
  assert "Recent logs" in titles, p
PY

echo "==> crea-otel package contract"
test -f packages/crea-otel/package.json
test -f .github/workflows/publish-otel.yml
grep -q '"name": "@crearec/otel"' packages/crea-otel/package.json
grep -q '"registry": "https://npm.pkg.github.com"' packages/crea-otel/package.json
grep -q "packages: write" .github/workflows/publish-otel.yml
grep -q "otel-v" .github/workflows/publish-otel.yml
grep -q "npm publish" .github/workflows/publish-otel.yml
grep -q 'bot_updates_total' packages/crea-otel/README.md
grep -q 'bot_handler_duration_seconds' packages/crea-otel/README.md
grep -q 'recordHandledUpdate' packages/crea-otel/README.md

echo "==> listen-ports script syntax"
sh -n config/listen-ports/export.sh
python3 -m py_compile scripts/media-usb-metrics.py

echo "==> telegram alerting provisioning"
grep -qE 'GF_TELEGRAM_BOT_TOKEN:[[:space:]]*\$\{GF_TELEGRAM_BOT_TOKEN:-\}' docker-compose.yml
grep -q 'GF_TELEGRAM_CHAT_ID: \${GF_TELEGRAM_CHAT_ID:-165484160}' docker-compose.yml
grep -q '^GF_TELEGRAM_BOT_TOKEN=$' .env.example
grep -q '^GF_TELEGRAM_CHAT_ID=165484160$' .env.example
grep -q 'type: telegram' config/grafana/provisioning/alerting/telegram.yaml
grep -q 'bottoken: \$GF_TELEGRAM_BOT_TOKEN' config/grafana/provisioning/alerting/telegram.yaml
grep -q '\$GF_TELEGRAM_CHAT_ID' config/grafana/provisioning/alerting/telegram.yaml
grep -q 'receiver: telegram' config/grafana/provisioning/alerting/telegram.yaml
if grep -q 'grafana-default-email' config/grafana/provisioning/alerting/telegram.yaml; then
  echo "unexpected grafana-default-email in telegram.yaml" >&2
  exit 1
fi
if grep -qiE 'smtp|email' docker-compose.yml .env.example; then
  echo "unexpected SMTP/email leftovers in compose or .env.example" >&2
  exit 1
fi
grep -q "\['disk', '=', 'media-usb'\]" config/grafana/provisioning/alerting/telegram.yaml
grep -q 'define "crea_telegram.message"' config/grafana/provisioning/alerting/telegram.yaml
# Bot tokens look like 123456789:AAH... — must never be committed.
! grep -RE '[0-9]{8,}:[A-Za-z0-9_-]{20,}' --include='*.yml' --include='*.yaml' --include='*.md' --include='*.example' --include='docker-compose.yml' config docs .env.example docker-compose.yml

echo "==> docker compose config"
docker network create lgtm 2>/dev/null || true
cp .env.example .env
docker compose config -q

echo "OK"
