import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { phaseMeta } from "./cloud-control-runbook-evidence";
import { httpCommands } from "./cloud-control-runbook-http";
import {
  imagePublicationCommand,
  imagePublicationInputs,
} from "./cloud-control-runbook-image-publication";
import { managedRuntimeFlags, sourceHostPrelude } from "./cloud-control-runbook-managed-runtime";
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
          "image-publication",
          imagePublicationCommand(input, rootPrelude(input.outDir)),
          imagePublicationInputs(input),
          ["$PROFILE_ROOT/image-publication.json"],
          "registry inspection digest matches immutable image reference",
        ),
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
      httpCommands(input, rootPrelude(input.outDir)),
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
  const body = `${rootPrelude(input.outDir)}; ${sourceHostPrelude()}; deployment-control-plane managed-dependencies --profile "$PROFILE_ROOT/managed-dependencies.profile.yaml" --credential-directory ${CREDENTIAL_DIR} --source-host-identity "$SOURCE_HOST_IDENTITY" --source-host-kind "$SOURCE_HOST_KIND" ${managedRuntimeFlags(input)}`;
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

const doctor = (input: CloudControlSetupInput) =>
  `${rootPrelude(input.outDir)}; deployment-control-plane setup-doctor --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/setup-doctor.json"`;

const preflight = (input: CloudControlSetupInput) =>
  `${rootPrelude(input.outDir)}; deployment-control-plane credential-preflight --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/credential-preflight.json"`;

function rootPrelude(outDir: string): string {
  return `PROFILE_ROOT="\${PROFILE_ROOT:-$(pwd)}"; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then PROFILE_ROOT=${shellQuote(outDir)}; fi; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then echo "commands.json not found; run from repo root or bundle directory" >&2; exit 2; fi`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
