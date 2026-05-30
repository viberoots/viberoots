import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { phaseMeta, processWorkerOutputPaths } from "./cloud-control-runbook-evidence";
export { validateRunbookBundle, validateRunbookStructure } from "./cloud-control-runbook-doctor";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";
export const RUNBOOK_SCHEMA = "cloud-control-runbook@1";

export type RunbookCommand = {
  id: string;
  command: string;
  cwd: "profile-root";
  inputs: string[];
  outputs: string[];
  mustPass: string;
};

export type RunbookPhase = {
  id: string;
  order: number;
  title: string;
  prerequisites: string[];
  evidenceInputs: string[];
  residualManualActions: string[];
  commands: RunbookCommand[];
};

export function renderCommands(input: CloudControlSetupInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: RUNBOOK_SCHEMA,
      image: input.image,
      imagePublication: input.imagePublication,
      profileRoot: {
        bundleRelative: ".",
        repoRootRelative: input.outDir,
        commandCwd: "profile-root",
      },
      phases: phases(input),
    },
    null,
    2,
  )}\n`;
}

function phases(input: CloudControlSetupInput): RunbookPhase[] {
  return [
    phase(
      input,
      1,
      "local-review",
      "Review generated local bundle",
      [],
      [
        command(
          "setup-doctor",
          doctor(input),
          localInputs(),
          ["$PROFILE_ROOT/setup-doctor.json"],
          "runbook structure is valid",
        ),
      ],
    ),
    phase(
      input,
      2,
      "credential-preflight",
      "Validate staged credential files",
      ["local-review"],
      [
        command(
          "credential-preflight",
          preflight(input),
          localInputs(),
          ["$PROFILE_ROOT/credential-preflight.json"],
          "credential manifest and files match",
        ),
      ],
    ),
    phase(
      input,
      3,
      "managed-dependencies",
      "Validate managed dependencies",
      ["credential-preflight"],
      managedCommands(input),
    ),
    phase(
      input,
      4,
      "process-start",
      "Start service and workers",
      ["credential-preflight"],
      processCommands(input),
    ),
    phase(
      input,
      5,
      "http-validation",
      "Validate service HTTP checks",
      ["process-start"],
      httpCommands(input),
    ),
  ];
}

function phase(
  input: CloudControlSetupInput,
  order: number,
  id: string,
  title: string,
  prerequisites: string[],
  commands: RunbookCommand[],
): RunbookPhase {
  const meta = phaseMeta(id, input);
  return {
    id,
    order,
    title,
    prerequisites,
    evidenceInputs: meta.evidenceInputs,
    residualManualActions: meta.residualManualActions,
    commands,
  };
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

function localInputs(): string[] {
  return [
    "$PROFILE_ROOT/config.yaml",
    "$PROFILE_ROOT/credential-manifest.json",
    "$PROFILE_ROOT/commands.json",
  ];
}

function managedCommands(input: CloudControlSetupInput): RunbookCommand[] {
  const body = `${rootPrelude(input.outDir)}; deployment-control-plane managed-dependencies --profile "$PROFILE_ROOT/managed-dependencies.profile.yaml" --credential-directory ${CREDENTIAL_DIR}`;
  const inputs = [
    ...localInputs(),
    "$PROFILE_ROOT/managed-dependencies.profile.yaml",
    "$PROFILE_ROOT/credential-preflight.json",
  ];
  return [
    command(
      "database",
      body,
      inputs,
      ["$PROFILE_ROOT/managed-dependency-evidence.json"],
      "managed Postgres feature conformance passes",
    ),
    command(
      "artifact-store",
      body,
      inputs,
      ["$PROFILE_ROOT/managed-dependency-evidence.json"],
      "artifact store PUT, GET, HEAD, metadata, content-type, and digest checks pass",
    ),
  ];
}

function processCommands(input: CloudControlSetupInput): RunbookCommand[] {
  const service = command(
    "service",
    "deployment-control-plane service --config /etc/deployment-control-plane/config.yaml",
    ["$PROFILE_ROOT/credential-preflight.json"],
    ["$PROFILE_ROOT/process-service.json"],
    "service process starts",
  );
  const workers = Array.from({ length: input.workerReplicas }, (_, index) =>
    command(
      `worker-${index + 1}`,
      `deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml --worker-id worker-${index + 1}`,
      ["$PROFILE_ROOT/credential-preflight.json"],
      [`$PROFILE_ROOT/process-worker-${index + 1}.json`],
      "worker process starts",
    ),
  );
  return [service, ...workers];
}

function httpCommands(input: CloudControlSetupInput): RunbookCommand[] {
  return [
    command(
      "health",
      httpCommand(
        input,
        `${curl(url(input.publicUrl, "/healthz"))} | tee "$PROFILE_ROOT/http-health.json"`,
      ),
      ["$PROFILE_ROOT/process-service.json"],
      ["$PROFILE_ROOT/http-health.json"],
      "process liveness returns expected metadata",
    ),
    command(
      "readiness",
      httpCommand(
        input,
        `${curl(url(input.publicUrl, "/readyz"))} | tee "$PROFILE_ROOT/http-readiness.json"`,
      ),
      ["$PROFILE_ROOT/process-service.json", "$PROFILE_ROOT/managed-dependency-evidence.json"],
      ["$PROFILE_ROOT/http-readiness.json"],
      "database, artifact-store, and worker heartbeat readiness are ok",
    ),
    command(
      "worker-heartbeats",
      httpCommand(
        input,
        `${authCurl(url(input.publicUrl, "/api/v1/worker-heartbeats"))} | tee "$PROFILE_ROOT/http-worker-heartbeats.json"`,
      ),
      ["$PROFILE_ROOT/process-service.json", ...processWorkerOutputPaths(input)],
      ["$PROFILE_ROOT/http-worker-heartbeats.json"],
      `at least ${input.workerReplicas} running workers report fresh heartbeats`,
    ),
  ];
}

const doctor = (input: CloudControlSetupInput) =>
  `${rootPrelude(input.outDir)}; deployment-control-plane setup-doctor --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/setup-doctor.json"`;

const preflight = (input: CloudControlSetupInput) =>
  `${rootPrelude(input.outDir)}; deployment-control-plane credential-preflight --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/credential-preflight.json"`;

const httpCommand = (input: CloudControlSetupInput, body: string) =>
  `${rootPrelude(input.outDir)}; ${body}`;

const curl = (targetUrl: string) => `curl -fsS ${shellQuote(targetUrl)}`;

function rootPrelude(outDir: string): string {
  return `PROFILE_ROOT="\${PROFILE_ROOT:-$(pwd)}"; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then PROFILE_ROOT=${shellQuote(outDir)}; fi; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then echo "commands.json not found; run from repo root or bundle directory" >&2; exit 2; fi`;
}

function authCurl(targetUrl: string): string {
  return `CREDENTIAL_ROOT="\${CREDENTIAL_DIR:-${CREDENTIAL_DIR}}"; TOKEN_FILE="$CREDENTIAL_ROOT/control-plane-token"; AUTH_CONFIG="$(mktemp)"; trap 'rm -f "$AUTH_CONFIG"' EXIT; printf 'header = "Authorization: Bearer %s"\\n' "$(tr -d '\\r\\n' < "$TOKEN_FILE")" > "$AUTH_CONFIG"; chmod 600 "$AUTH_CONFIG"; curl -fsS --config "$AUTH_CONFIG" ${shellQuote(targetUrl)}`;
}

function url(publicUrl: string, pathname: string): string {
  return new URL(pathname, publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`).toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
