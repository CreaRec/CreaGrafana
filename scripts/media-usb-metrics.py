#!/usr/bin/env python3
"""Collect SMART and filesystem metrics for /mnt/media-usb (/dev/sdb) and export via textfile + OTLP HTTP.

When permitted, uses `smartctl -n standby` so a sleeping disk is not spun up.
In standby: emit presence + media_usb_disk_standby=1 + last-success timestamp,
but skip SMART attributes and statvfs (ntfs-3g may wake the drive to report free space).
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEVICE = "/dev/sdb"
DISK_BY_ID = "/dev/disk/by-id/usb-Seagate_Backup+_Desk_NA5JX40M-0:0"
MOUNTPOINT = "/mnt/media-usb"
PROM_PATH = Path("/home/grok/media-usb-metrics/media_usb_disk.prom")
OTLP_URL = os.environ.get("OTLP_METRICS_URL", "http://127.0.0.1:4318/v1/metrics")
LOCK_PATH = "/tmp/media-usb-metrics.lock"
HOST_LABEL = "debian-server"
SMARTCTL = "/usr/sbin/smartctl"

# SMART attribute IDs -> metric suffixes
SMART_ATTR_IDS = {
    5: ("media_usb_smart_reallocated_sectors", "SMART ID 5 Reallocated_Sector_Ct raw value"),
    9: ("media_usb_smart_power_on_hours", "SMART ID 9 Power_On_Hours raw value"),
    187: ("media_usb_smart_reported_uncorrect_errors", "SMART ID 187 Reported_Uncorrect raw value"),
    194: ("media_usb_smart_temperature_celsius", "SMART ID 194 Temperature_Celsius raw value in Celsius"),
    197: ("media_usb_smart_pending_sectors", "SMART ID 197 Current_Pending_Sector raw value"),
    198: ("media_usb_smart_offline_uncorrectable_sectors", "SMART ID 198 Offline_Uncorrectable raw value"),
    199: ("media_usb_smart_udma_crc_errors", "SMART ID 199 UDMA_CRC_Error_Count raw value"),
}

ATTR_LINE_RE = re.compile(
    r"^\s*(\d+)\s+(\S+)\s+0x[0-9a-fA-F]+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(-?\d+)"
)
# smartctl -n standby: "Device is in STANDBY mode, exiting" / "Power mode is: STANDBY"
STANDBY_RE = re.compile(
    r"Device is in (STANDBY|SLEEP)(?:\s+\([^)]+\))? mode"
    r"|Power mode is:\s*(STANDBY|SLEEP)\b",
    re.I,
)


def is_mount_present(mountpoint: str) -> bool:
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == mountpoint:
                    return True
    except OSError:
        pass
    return os.path.ismount(mountpoint)


def is_expected_disk_present() -> bool:
    if not os.path.exists(DEVICE):
        return False
    if os.path.exists(DISK_BY_ID):
        return os.path.realpath(DISK_BY_ID) == os.path.realpath(DEVICE)
    return False


def parse_smartctl_output(output: str) -> tuple[int | None, dict[int, int]]:
    health_passed: int | None = None
    attrs: dict[int, int] = {}

    for line in output.splitlines():
        if "SMART overall-health self-assessment test result:" in line:
            result = line.split(":", 1)[1].strip().upper()
            health_passed = 1 if result == "PASSED" else 0
            continue
        m = ATTR_LINE_RE.match(line)
        if m:
            attr_id = int(m.group(1))
            raw_val = int(m.group(3))
            attrs[attr_id] = raw_val

    if 194 not in attrs and 190 in attrs:
        attrs[194] = attrs[190]

    return health_passed, attrs


def is_standby_output(returncode: int, output: str) -> bool:
    """True when smartctl -n standby skipped the disk because it is sleeping.

    Exit bit 1 (value 2) is set in this case, together with a STANDBY/SLEEP message.
    Bit 1 alone is not enough (device-open failures use the same bit).
    """
    text = output or ""
    if STANDBY_RE.search(text):
        return True
    if (returncode & 0x02) and re.search(r"\b(STANDBY|SLEEP)\b", text, re.I):
        return True
    return False


def smartctl_n_standby_permitted() -> bool:
    """True when sudoers allows exactly: smartctl -n standby -a /dev/sdb."""
    try:
        proc = subprocess.run(
            ["sudo", "-n", "-l", "--", SMARTCTL, "-n", "standby", "-a", DEVICE],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return proc.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def run_smartctl() -> tuple[int, str, bool]:
    """Run smartctl, preferring -n standby when sudoers allows it.

    Returns (returncode, combined output, used_standby_flag).
    """
    use_standby_flag = smartctl_n_standby_permitted()
    if use_standby_flag:
        cmd = ["sudo", "-n", SMARTCTL, "-n", "standby", "-a", DEVICE]
    else:
        cmd = ["sudo", "-n", SMARTCTL, "-a", DEVICE]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    return proc.returncode, combined, use_standby_flag


def collect_metrics() -> list[tuple[str, str, float]]:
    now = time.time()
    metrics: list[tuple[str, str, float]] = []

    disk_present = 1 if is_expected_disk_present() else 0
    standby = 0
    smart_health: int | None = None
    smart_attrs: dict[int, int] = {}

    if disk_present:
        try:
            rc, output, used_standby_flag = run_smartctl()
            if used_standby_flag and is_standby_output(rc, output):
                standby = 1
            elif (rc & 0x03) == 0:
                # Bits 0-1 clear: CLI parsed and the device was opened (awake).
                # Bit 5 (32) means an attribute failed in the past (e.g. Airflow_Temperature_Cel).
                health, parsed = parse_smartctl_output(output)
                if health is not None:
                    smart_health = health
                    smart_attrs = parsed
        except (subprocess.SubprocessError, OSError):
            pass

    metrics.append(("media_usb_disk_present", "Whether the expected /dev/sdb Seagate USB disk is present (1=yes, 0=no)", float(disk_present)))
    metrics.append(("media_usb_disk_standby", "Whether the disk is in STANDBY/SLEEP (1=sleeping, not spun up; 0=awake or unknown)", float(standby)))

    if standby == 0 and smart_health is not None:
        metrics.append(("media_usb_smart_health_passed", "SMART overall-health assessment (1=PASSED, 0=FAILED)", float(smart_health)))
        for attr_id, (name, help_text) in SMART_ATTR_IDS.items():
            if attr_id in smart_attrs:
                metrics.append((name, help_text, float(smart_attrs[attr_id])))

    mount_present = 1 if is_mount_present(MOUNTPOINT) else 0
    metrics.append(("media_usb_mount_present", "Whether /mnt/media-usb is currently mounted (1=yes, 0=no)", float(mount_present)))

    # Skip statvfs while the disk is sleeping: ntfs-3g may read volume metadata
    # (free-cluster info) and spin the drive up.
    if mount_present == 1 and standby == 0:
        try:
            st = os.statvfs(MOUNTPOINT)
            size_bytes = float(st.f_blocks * st.f_frsize)
            avail_bytes = float(st.f_bavail * st.f_frsize)
            metrics.append(("media_usb_fs_size_bytes", "Total filesystem size in bytes for /mnt/media-usb", size_bytes))
            metrics.append(("media_usb_fs_avail_bytes", "Available filesystem space in bytes for /mnt/media-usb", avail_bytes))
        except OSError:
            pass

    metrics.append(("media_usb_metrics_last_success_timestamp_seconds", "Unix timestamp of last successful media-usb collector run", now))
    return metrics


def write_prom_textfile(metrics: list[tuple[str, str, float]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    labels = f'host="{HOST_LABEL}",device="{DEVICE}",mountpoint="{MOUNTPOINT}"'
    for name, help_text, value in metrics:
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} gauge")
        if value.is_integer() and "timestamp" not in name:
            val_str = str(int(value))
        else:
            val_str = f"{value:.3f}" if "timestamp" in name else str(value)
        lines.append(f"{name}{{{labels}}} {val_str}")
    content = "\n".join(lines) + "\n"
    tmp_path = path.with_suffix(".prom.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(tmp_path, 0o644)
    os.replace(tmp_path, path)


def push_otlp_http(metrics: list[tuple[str, str, float]], url: str) -> None:
    ts_ns = str(int(time.time() * 1_000_000_000))
    common_attrs = [
        {"key": "host", "value": {"stringValue": HOST_LABEL}},
        {"key": "device", "value": {"stringValue": DEVICE}},
        {"key": "mountpoint", "value": {"stringValue": MOUNTPOINT}},
    ]
    otlp_metrics = []
    for name, help_text, value in metrics:
        otlp_metrics.append(
            {
                "name": name,
                "description": help_text,
                "gauge": {
                    "dataPoints": [
                        {
                            "attributes": common_attrs,
                            "timeUnixNano": ts_ns,
                            "asDouble": float(value),
                        }
                    ]
                },
            }
        )

    payload = {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "media-usb-disk"}},
                        {"key": "service.namespace", "value": {"stringValue": "host"}},
                        {"key": "deployment.environment", "value": {"stringValue": "production"}},
                    ]
                },
                "scopeMetrics": [
                    {
                        "scope": {"name": "media-usb-metrics", "version": "1.1.0"},
                        "metrics": otlp_metrics,
                    }
                ],
            }
        ]
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"OTLP push failed with HTTP {resp.status}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print metrics without writing or pushing")
    args = parser.parse_args()

    with open(LOCK_PATH, "w", encoding="utf-8") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0

        metrics = collect_metrics()
        if args.dry_run:
            for name, _, val in metrics:
                print(f"{name} {val}")
            return 0

        write_prom_textfile(metrics, PROM_PATH)
        push_otlp_http(metrics, OTLP_URL)
        return 0


if __name__ == "__main__":
    sys.exit(main())
