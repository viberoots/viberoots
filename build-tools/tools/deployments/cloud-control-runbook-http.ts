import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { processWorkerOutputPaths } from "./cloud-control-runbook-evidence";
import type { RunbookCommand } from "./cloud-control-runbook";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";

export function httpCommands(input: CloudControlSetupInput, rootPrelude: string): RunbookCommand[] {
  return [
    command(
      "health",
      `${rootPrelude}; ${curl(url(input.publicUrl, "/healthz"))} | tee "$PROFILE_ROOT/http-health.json"`,
      ["$PROFILE_ROOT/process-service.json"],
      ["$PROFILE_ROOT/http-health.json"],
      "process liveness returns expected metadata",
    ),
    command(
      "readiness",
      `${rootPrelude}; ${curl(url(input.publicUrl, "/readyz"))} | tee "$PROFILE_ROOT/http-readiness.json"`,
      ["$PROFILE_ROOT/process-service.json", "$PROFILE_ROOT/managed-dependency-evidence.json"],
      ["$PROFILE_ROOT/http-readiness.json"],
      "database, artifact-store, and worker heartbeat readiness are ok",
    ),
    command(
      "worker-heartbeats",
      `${rootPrelude}; ${authCurl(url(input.publicUrl, "/api/v1/worker-heartbeats"))} | tee "$PROFILE_ROOT/http-worker-heartbeats.json"`,
      ["$PROFILE_ROOT/process-service.json", ...processWorkerOutputPaths(input)],
      ["$PROFILE_ROOT/http-worker-heartbeats.json"],
      `at least ${input.workerReplicas} running workers report fresh heartbeats`,
    ),
  ];
}

function command(
  id: string,
  body: string,
  inputs: string[],
  outputs: string[],
  mustPass: string,
): RunbookCommand {
  return { id, command: body, cwd: "profile-root", inputs, outputs, mustPass };
}

const curl = (targetUrl: string) => `curl -fsS ${shellQuote(targetUrl)}`;

function authCurl(targetUrl: string): string {
  return `CREDENTIAL_ROOT="\${CREDENTIAL_DIR:-${CREDENTIAL_DIR}}"; TOKEN_FILE="$CREDENTIAL_ROOT/control-plane-token"; AUTH_CONFIG="$(mktemp)"; trap 'rm -f "$AUTH_CONFIG"' EXIT; printf 'header = "Authorization: Bearer %s"\\n' "$(tr -d '\\r\\n' < "$TOKEN_FILE")" > "$AUTH_CONFIG"; chmod 600 "$AUTH_CONFIG"; curl -fsS --config "$AUTH_CONFIG" ${shellQuote(targetUrl)}`;
}

function url(publicUrl: string, pathname: string): string {
  return new URL(pathname, publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`).toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
