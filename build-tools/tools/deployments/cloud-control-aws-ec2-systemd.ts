import {
  CONTROL_PLANE_CONFIG,
  CONTROL_PLANE_CREDS,
  CONTROL_PLANE_STATE,
  type RenderedControlPlaneProcess,
} from "./cloud-control-process-contract";

export function systemdUnit(process: RenderedControlPlaneProcess): string {
  const containerName = process.name;
  return [
    "[Unit]",
    `Description=Viberoots ${process.name}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "User=10001",
    "Group=10001",
    "Restart=always",
    "RestartSec=10s",
    "KillSignal=SIGTERM",
    "TimeoutStopSec=60",
    `ExecStartPre=-/usr/bin/podman rm -f ${containerName}`,
    `ExecStart=${podmanCommand(process, containerName)}`,
    `ExecStartPost=${healthReference(process)}`,
    `ExecStop=/usr/bin/podman stop --time 60 ${containerName}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

export function podmanRun(processes: RenderedControlPlaneProcess[]): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'BUNDLE_ROOT="${VIBEROOTS_CONTROL_PLANE_BUNDLE:-$SCRIPT_DIR}"',
    'UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"',
    ...hostContractInstallLines(),
    'install -d "$UNIT_DIR"',
    'install -m 0644 "$BUNDLE_ROOT"/systemd/*.service "$UNIT_DIR"/',
    "systemctl daemon-reload",
    ...processes.map((process) => `systemctl enable --now ${process.systemdUnit}`),
    "",
  ].join("\n");
}

export function userDataScript(processes: RenderedControlPlaneProcess[]): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Activates generated units only; provider state changes are handled by provider-capability hooks.",
    'BUNDLE_ROOT="${VIBEROOTS_CONTROL_PLANE_BUNDLE:-/opt/viberoots-control-plane}"',
    'UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"',
    ...hostContractInstallLines(),
    'install -d "$UNIT_DIR"',
    'install -m 0644 "$BUNDLE_ROOT"/systemd/*.service "$UNIT_DIR"/',
    "systemctl daemon-reload",
    ...processes.map((process) => `systemctl enable --now ${process.systemdUnit}`),
    "",
  ].join("\n");
}

function podmanCommand(process: RenderedControlPlaneProcess, containerName: string): string {
  return [
    "/usr/bin/podman run --replace --name",
    containerName,
    "--user 10001:10001",
    process.role === "service" ? "--publish 127.0.0.1:7780:7780" : "",
    mountArgs(),
    envArgs(process),
    process.image,
    ...process.command,
  ]
    .filter(Boolean)
    .join(" ");
}

function hostContractInstallLines(): string[] {
  return [
    `CONFIG_PATH="\${CONTROL_PLANE_CONFIG_PATH:-${CONTROL_PLANE_CONFIG}}"`,
    `CREDENTIAL_DIR="\${CONTROL_PLANE_CREDENTIAL_DIR:-${CONTROL_PLANE_CREDS}}"`,
    `STATE_ROOT="\${CONTROL_PLANE_STATE_ROOT:-${CONTROL_PLANE_STATE}}"`,
    'INSTALL_OWNER="${CONTROL_PLANE_INSTALL_OWNER:-10001:10001}"',
    'install -d "$(dirname "$CONFIG_PATH")"',
    'install -m 0644 "$BUNDLE_ROOT/config.yaml" "$CONFIG_PATH"',
    'if [ -n "$INSTALL_OWNER" ] && [ "$INSTALL_OWNER" != "skip" ]; then',
    '  install -d -m 0750 -o "${INSTALL_OWNER%:*}" -g "${INSTALL_OWNER#*:}" "$CREDENTIAL_DIR"',
    '  install -d -m 0750 -o "${INSTALL_OWNER%:*}" -g "${INSTALL_OWNER#*:}" "$STATE_ROOT/records" "$STATE_ROOT/artifacts" "$STATE_ROOT/runtime"',
    "else",
    '  install -d -m 0750 "$CREDENTIAL_DIR"',
    '  install -d -m 0750 "$STATE_ROOT/records" "$STATE_ROOT/artifacts" "$STATE_ROOT/runtime"',
    "fi",
  ];
}

function mountArgs(): string {
  return [
    `--volume ${CONTROL_PLANE_CONFIG}:${CONTROL_PLANE_CONFIG}:ro`,
    `--volume ${CONTROL_PLANE_CREDS}:${CONTROL_PLANE_CREDS}:ro`,
    `--volume ${CONTROL_PLANE_STATE}/records:${CONTROL_PLANE_STATE}/records:rw`,
    `--volume ${CONTROL_PLANE_STATE}/artifacts:${CONTROL_PLANE_STATE}/artifacts:rw`,
    `--volume ${CONTROL_PLANE_STATE}/runtime:${CONTROL_PLANE_STATE}/runtime:rw`,
  ].join(" ");
}

function envArgs(process: RenderedControlPlaneProcess): string {
  return Object.entries(process.environment)
    .map(([key, value]) => `--env ${key}=${value}`)
    .join(" ");
}

function healthReference(process: RenderedControlPlaneProcess): string {
  if (process.role === "service") {
    return "/usr/bin/curl -fsS http://127.0.0.1:7780/healthz && /usr/bin/curl -fsS http://127.0.0.1:7780/readyz";
  }
  return `/bin/sh -lc '/usr/bin/podman inspect --format "{{.State.Running}}" ${process.name} | /usr/bin/grep -qx true'`;
}
