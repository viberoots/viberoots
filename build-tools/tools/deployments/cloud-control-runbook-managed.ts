import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import type { RunbookCommand } from "./cloud-control-runbook";
import { managedRuntimeFlags, sourceHostPrelude } from "./cloud-control-runbook-managed-runtime";
import { rootPrelude } from "./cloud-control-runbook-root";
import {
  supabasePrivateLinkEvidenceCommands,
  supabasePrivateLinkIacCommands,
} from "./cloud-control-runbook-supabase-privatelink";
import { supabasePostgresEvidenceCommand } from "./cloud-control-runbook-supabase-postgres";
import { providerCapabilityEvidenceCommands } from "./cloud-control-runbook-provider-capabilities";
import { ecrIacCommands } from "./cloud-control-runbook-ecr-iac";
import { ec2AsgIacCommands } from "./cloud-control-runbook-ec2-asg-iac";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";

export function managedCommands(input: CloudControlSetupInput): RunbookCommand[] {
  const body = `${rootPrelude(input.outDir)}; ${sourceHostPrelude(input.mode)}; deployment-control-plane managed-dependencies --profile "$PROFILE_ROOT/managed-dependencies.profile.yaml" --credential-directory ${CREDENTIAL_DIR} --source-host-identity "$SOURCE_HOST_IDENTITY" --source-host-kind "$SOURCE_HOST_KIND" ${managedRuntimeFlags(input)}`;
  const inputs = [
    ...localInputs(),
    "$PROFILE_ROOT/managed-dependencies.profile.yaml",
    "$PROFILE_ROOT/supabase-managed-postgres-evidence.json",
    "$PROFILE_ROOT/credential-preflight.json",
  ];
  return [
    supabasePostgresEvidenceCommand(input),
    ...ecrIacCommands(input, rootPrelude(input.outDir)),
    ...ec2AsgIacCommands(input, rootPrelude(input.outDir)),
    ...supabasePrivateLinkEvidenceCommands(input, rootPrelude(input.outDir)),
    ...supabasePrivateLinkIacCommands(input, rootPrelude(input.outDir)),
    ...providerCapabilityEvidenceCommands(input),
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
