import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { phaseMeta } from "./cloud-control-runbook-evidence";
import { httpCommands } from "./cloud-control-runbook-http";
import { ingressEvidenceCommands } from "./cloud-control-runbook-ingress";
import {
  imagePublicationCommand,
  imagePublicationInputs,
} from "./cloud-control-runbook-image-publication";
import { managedCommands } from "./cloud-control-runbook-managed";
import { rootPrelude } from "./cloud-control-runbook-root";
import { credentialCommands } from "./cloud-control-runbook-credential-commands";
import { cutoverCommands } from "./cloud-control-runbook-cutover";
export { validateRunbookBundle, validateRunbookStructure } from "./cloud-control-runbook-doctor";

export const RUNBOOK_SCHEMA = "cloud-control-runbook@1";

export type RunbookCommand = {
  id: string;
  command: string;
  cwd: "profile-root";
  inputs: string[];
  outputs: string[];
  mustPass: string;
} & Partial<Record<"actionType" | "evidenceGuidance", string>>;

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
      "Validate and stage credential evidence",
      ["local-review"],
      credentialCommands(input),
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
      [
        ...ingressEvidenceCommands(input, rootPrelude(input.outDir)),
        ...httpCommands(input, rootPrelude(input.outDir)),
      ],
    ),
    phase(
      input,
      6,
      "cutover-readiness",
      "Collect and validate cutover evidence",
      ["http-validation"],
      cutoverCommands(input),
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
    "$PROFILE_ROOT/runtime-input.yaml",
    "$PROFILE_ROOT/credential-manifest.json",
    "$PROFILE_ROOT/credential-map.json",
    "$PROFILE_ROOT/auth-provider-profile.json",
    "$PROFILE_ROOT/residual-action-checklist.json",
    "$PROFILE_ROOT/commands.json",
  ];
}

function processCommands(input: CloudControlSetupInput): RunbookCommand[] {
  if (input.mode === "aws-ec2") return awsEc2ProcessCommands(input);
  const service = command(
    "service",
    "control-plane service --config /etc/deployment-control-plane/config.yaml",
    ["$PROFILE_ROOT/credential-preflight.json"],
    ["$PROFILE_ROOT/process-service.json"],
    "service process starts",
  );
  const workers = Array.from({ length: input.workerReplicas }, (_, index) =>
    command(
      `worker-${index + 1}`,
      `control-plane worker --config /etc/deployment-control-plane/config.yaml --worker-id worker-${index + 1}`,
      ["$PROFILE_ROOT/credential-preflight.json"],
      [`$PROFILE_ROOT/process-worker-${index + 1}.json`],
      "worker process starts",
    ),
  );
  return [service, ...workers];
}

function awsEc2ProcessCommands(input: CloudControlSetupInput): RunbookCommand[] {
  const inputs = [
    "$PROFILE_ROOT/config.yaml",
    "$PROFILE_ROOT/credential-preflight.json",
    "$PROFILE_ROOT/aws-ec2-podman-run.sh",
    "$PROFILE_ROOT/systemd/deployment-control-plane-service.service",
    ...Array.from(
      { length: input.workerReplicas },
      (_, index) => `$PROFILE_ROOT/systemd/deployment-control-plane-worker-${index + 1}.service`,
    ),
  ];
  const service = command(
    "service",
    `${rootPrelude(input.outDir)}; bash "$PROFILE_ROOT/aws-ec2-podman-run.sh"; printf '{"ok":true,"activation":"aws-ec2-podman-run.sh"}\\n' > "$PROFILE_ROOT/process-service.json"`,
    inputs,
    ["$PROFILE_ROOT/process-service.json"],
    "generated AWS EC2 systemd service and workers are activated",
  );
  const workers = Array.from({ length: input.workerReplicas }, (_, index) =>
    command(
      `worker-${index + 1}`,
      `${rootPrelude(input.outDir)}; systemctl enable --now deployment-control-plane-worker-${index + 1}.service; printf '{"ok":true,"unit":"deployment-control-plane-worker-${index + 1}.service"}\\n' > "$PROFILE_ROOT/process-worker-${index + 1}.json"`,
      inputs,
      [`$PROFILE_ROOT/process-worker-${index + 1}.json`],
      "generated AWS EC2 worker unit is enabled",
    ),
  );
  return [service, ...workers];
}

const doctor = (input: CloudControlSetupInput) =>
  `${rootPrelude(input.outDir)}; control-plane setup-doctor --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/setup-doctor.json"`;
