#!/bin/sh
# Snapshot host TCP LISTEN sockets (ss -tlnp) into a Prometheus textfile.
# For choosing free ports for new apps. Enriches with Docker container + Compose service.
set -eu

OUT_DIR="${TEXTFILE_DIR:-/textfile}"
OUT_FILE="${OUT_DIR}/listen_ports.prom"
INTERVAL_SEC="${INTERVAL_SEC:-15}"
DOCKER_SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"

ensure_pkgs() {
  need=
  command -v ss >/dev/null 2>&1 || need="${need} iproute2"
  command -v curl >/dev/null 2>&1 || need="${need} curl"
  command -v jq >/dev/null 2>&1 || need="${need} jq"
  if [ -n "${need}" ]; then
    # shellcheck disable=SC2086
    apk add --no-cache ${need} >/dev/null
  fi
}

mkdir -p "${OUT_DIR}"
ensure_pkgs

# Write maps:
#   $1/by_id    <container_id>\t<name>\t<compose_service>
#   $1/by_port  <port>\t<name>\t<compose_service>  (tcp published ports)
build_docker_maps() {
  map_dir="$1"
  mkdir -p "${map_dir}"
  : >"${map_dir}/by_id"
  : >"${map_dir}/by_port"

  if [ ! -S "${DOCKER_SOCK}" ]; then
    return 0
  fi

  json="$(curl -sS --unix-socket "${DOCKER_SOCK}" http://localhost/containers/json 2>/dev/null || true)"
  if [ -z "${json}" ] || [ "${json}" = "null" ]; then
    return 0
  fi

  printf '%s' "${json}" | jq -r '
    .[] |
    .Id as $id |
    ((.Names[0] // "") | sub("^/"; "")) as $name |
    (.Labels["com.docker.compose.service"] // "-") as $svc |
    ($name | if . == "" then "-" else . end) as $cname |
    "\($id)\t\($cname)\t\($svc)",
    (if ($id | length) >= 12 then "\($id[0:12])\t\($cname)\t\($svc)" else empty end)
  ' >>"${map_dir}/by_id" 2>/dev/null || true

  printf '%s' "${json}" | jq -r '
    .[] |
    ((.Names[0] // "") | sub("^/"; "")) as $name |
    (.Labels["com.docker.compose.service"] // "-") as $svc |
    ($name | if . == "" then "-" else . end) as $cname |
    (.Ports // [])[] |
    select(.PublicPort != null and .Type == "tcp") |
    "\(.PublicPort)\t\($cname)\t\($svc)"
  ' >>"${map_dir}/by_port" 2>/dev/null || true
}

lookup_tsv() {
  # Prints name<TAB>service for key, or -/-
  awk -F '\t' -v k="$2" '$1 == k { print $2 "\t" $3; found=1; exit } END { if (!found) print "-\t-" }' "$1" 2>/dev/null || printf '%s\n' '-	-'
}

# Resolve container id from /proc/<pid>/cgroup (docker / containerd style).
pid_container_id() {
  pid="$1"
  cgroup="$(cat "/proc/${pid}/cgroup" 2>/dev/null || true)"
  [ -n "${cgroup}" ] || return 0

  printf '%s\n' "${cgroup}" | sed -n \
    -e 's/.*docker[/-]\([0-9a-f]\{64\}\).*/\1/p' \
    -e 's/.*cri-containerd-\([0-9a-f]\{64\}\).*/\1/p' \
    -e 's/.*\/\([0-9a-f]\{64\}\)$/\1/p' \
    | head -n 1
}

resolve_docker() {
  # Prints container_name<TAB>compose_service
  map_dir="$1"
  pid="$2"
  port="$3"

  if [ -n "${pid}" ] && [ -f "${map_dir}/by_id" ]; then
    cid="$(pid_container_id "${pid}" || true)"
    if [ -n "${cid}" ]; then
      row="$(lookup_tsv "${map_dir}/by_id" "${cid}")"
      name="$(printf '%s\n' "${row}" | awk -F '\t' '{print $1}')"
      if [ "${name}" != "-" ]; then
        printf '%s\n' "${row}"
        return 0
      fi
      short="$(printf '%s' "${cid}" | cut -c1-12)"
      row="$(lookup_tsv "${map_dir}/by_id" "${short}")"
      name="$(printf '%s\n' "${row}" | awk -F '\t' '{print $1}')"
      if [ "${name}" != "-" ]; then
        printf '%s\n' "${row}"
        return 0
      fi
    fi
  fi

  if [ -f "${map_dir}/by_port" ]; then
    lookup_tsv "${map_dir}/by_port" "${port}"
    return 0
  fi

  printf '%s\n' '-	-'
}

write_metrics() {
  tmp="$(mktemp "${OUT_DIR}/listen_ports.prom.XXXXXX")"
  body="$(mktemp "${OUT_DIR}/listen_ports.body.XXXXXX")"
  map_dir="$(mktemp -d "${OUT_DIR}/docker_maps.XXXXXX")"
  ss_out="$(mktemp "${OUT_DIR}/ss.XXXXXX")"
  rows="$(mktemp "${OUT_DIR}/rows.XXXXXX")"

  build_docker_maps "${map_dir}"
  # TCP listening only (skip UDP UNCONN noise).
  # Note: ss -tlnp often omits the Netid column (State is $1); ss -tulpn includes it.
  ss -H -tlnp 2>/dev/null >"${ss_out}" || true

  while IFS= read -r line || [ -n "${line}" ]; do
    [ -z "${line}" ] && continue

    col1="$(printf '%s\n' "${line}" | awk '{print $1}')"
    # Format A (with Netid): tcp LISTEN Recv-Q Send-Q Local Peer ...
    # Format B (no Netid):   LISTEN Recv-Q Send-Q Local Peer ...
    case "${col1}" in
      tcp)
        state="$(printf '%s\n' "${line}" | awk '{print $2}')"
        local="$(printf '%s\n' "${line}" | awk '{print $5}')"
        ;;
      LISTEN)
        state="LISTEN"
        local="$(printf '%s\n' "${line}" | awk '{print $4}')"
        ;;
      *) continue ;;
    esac

    [ "${state}" = "LISTEN" ] || continue

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
    pid="$(printf '%s\n' "${line}" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)"

    docker_row="$(resolve_docker "${map_dir}" "${pid}" "${port}")"
    container_name="$(printf '%s\n' "${docker_row}" | awk -F '\t' '{print $1}')"
    compose_service="$(printf '%s\n' "${docker_row}" | awk -F '\t' '{print $2}')"

    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${addr}" "${port}" "${process}" "${container_name}" "${compose_service}"
  done <"${ss_out}" >"${rows}"

  # ss often lists the same listen twice (with and without users:(...)); keep one row per
  # addr|port, preferring a resolved process / docker labels over unknowns.
  awk -F '\t' '
    function esc(s) {
      gsub(/\\/, "\\\\", s)
      gsub(/"/, "\\\"", s)
      gsub(/\n/, "\\n", s)
      return s
    }
    {
      key = $1 SUBSEP $2
      proc = $3; container = $4; svc = $5
      score = 0
      if (proc != "" && proc != "unknown") score += 4
      if (container != "" && container != "-") score += 2
      if (svc != "" && svc != "-") score += 1
      if (!(key in best_score) || score > best_score[key]) {
        best_score[key] = score
        best_proc[key] = proc
        best_container[key] = container
        best_svc[key] = svc
        best_addr[key] = $1
        best_port[key] = $2
      }
    }
    END {
      for (k in best_score) {
        printf "host_socket_listen{netid=\"tcp\",state=\"LISTEN\",local_addr=\"%s\",port=\"%s\",process=\"%s\",container=\"%s\",compose_service=\"%s\"} 1\n", \
          esc(best_addr[k]), esc(best_port[k]), \
          esc(best_proc[k]), esc(best_container[k]), esc(best_svc[k])
      }
    }
  ' "${rows}" >"${body}"

  {
    printf '%s\n' '# HELP host_socket_listen Host TCP LISTEN sockets (from ss -tlnp); for finding free ports.'
    printf '%s\n' '# TYPE host_socket_listen gauge'
    cat "${body}"
  } >"${tmp}"

  rm -f "${body}" "${ss_out}" "${rows}"
  rm -rf "${map_dir}"
  mv "${tmp}" "${OUT_FILE}"
}

echo "listen-ports exporter writing ${OUT_FILE} every ${INTERVAL_SEC}s"
while true; do
  write_metrics
  sleep "${INTERVAL_SEC}"
done
