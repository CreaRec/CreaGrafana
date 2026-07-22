#!/bin/sh
# Snapshot host listening / unbound sockets (ss -tulpn) into a Prometheus textfile.
set -eu

OUT_DIR="${TEXTFILE_DIR:-/textfile}"
OUT_FILE="${OUT_DIR}/listen_ports.prom"
INTERVAL_SEC="${INTERVAL_SEC:-15}"

if ! command -v ss >/dev/null 2>&1; then
  apk add --no-cache iproute2 >/dev/null
fi

mkdir -p "${OUT_DIR}"

prom_escape() {
  # Escape \, ", and newlines for Prometheus label values.
  printf '%s' "$1" | awk 'BEGIN{ORS=""} {
    gsub(/\\/, "\\\\")
    gsub(/"/, "\\\"")
    gsub(/\n/, "\\n")
    print
  }'
}

write_metrics() {
  tmp="$(mktemp "${OUT_DIR}/listen_ports.prom.XXXXXX")"
  body="$(mktemp "${OUT_DIR}/listen_ports.body.XXXXXX")"

  # -H: no header; -tulpn: tcp/udp listening + process names
  ss -H -tulpn 2>/dev/null | while IFS= read -r line || [ -n "${line}" ]; do
    [ -z "${line}" ] && continue

    netid="$(printf '%s\n' "${line}" | awk '{print $1}')"
    state="$(printf '%s\n' "${line}" | awk '{print $2}')"
    local="$(printf '%s\n' "${line}" | awk '{print $5}')"

    case "${netid}" in
      tcp|udp) ;;
      *) continue ;;
    esac

    case "${state}" in
      LISTEN|UNCONN) ;;
      *) continue ;;
    esac

    # Split Local Address:Port (IPv6 is [addr]:port)
    case "${local}" in
      \[*\]*)
        addr="$(printf '%s\n' "${local}" | sed 's/^\[\([^]]*\)\]:.*/\1/')"
        port="$(printf '%s\n' "${local}" | sed 's/^\[.*\]://')"
        ;;
      *)
        addr="${local%:*}"
        port="${local##*:}"
        ;;
    esac

    process="$(printf '%s\n' "${line}" | sed -n 's/.*users:((\"\([^"]*\)\".*/\1/p')"
    if [ -z "${process}" ]; then
      process="unknown"
    fi

    netid_e="$(prom_escape "${netid}")"
    state_e="$(prom_escape "${state}")"
    addr_e="$(prom_escape "${addr}")"
    port_e="$(prom_escape "${port}")"
    process_e="$(prom_escape "${process}")"

    printf 'host_socket_listen{netid="%s",state="%s",local_addr="%s",port="%s",process="%s"} 1\n' \
      "${netid_e}" "${state_e}" "${addr_e}" "${port_e}" "${process_e}"
  done | awk '!seen[$0]++' >"${body}"

  {
    printf '%s\n' '# HELP host_socket_listen Host listening or unbound sockets (from ss -tulpn).'
    printf '%s\n' '# TYPE host_socket_listen gauge'
    cat "${body}"
  } >"${tmp}"

  rm -f "${body}"
  mv "${tmp}" "${OUT_FILE}"
}

echo "listen-ports exporter writing ${OUT_FILE} every ${INTERVAL_SEC}s"
while true; do
  write_metrics
  sleep "${INTERVAL_SEC}"
done
