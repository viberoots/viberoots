import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import type { RunbookCommand } from "./cloud-control-runbook";
import { rootPrelude } from "./cloud-control-runbook-root";

export function credentialCommands(input: CloudControlSetupInput): RunbookCommand[] {
  return [
    credentialCommand(
      "credential-preflight",
      `${rootPrelude(input.outDir)}; deployment-control-plane credential-preflight --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/credential-preflight.json"`,
      ["$PROFILE_ROOT/credential-preflight.json"],
      "credential manifest and files match",
    ),
    credentialCommand(
      "credential-staging",
      `${rootPrelude(input.outDir)}; deployment-control-plane credential-staging --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/credential-staging.json"`,
      ["$PROFILE_ROOT/credential-staging.json"],
      "credential staging evidence is fresh and bound to the manifest and map",
    ),
  ];
}

function credentialCommand(
  id: string,
  body: string,
  outputs: string[],
  mustPass: string,
): RunbookCommand {
  return {
    id,
    command: body,
    cwd: "profile-root",
    inputs: [
      "$PROFILE_ROOT/config.yaml",
      "$PROFILE_ROOT/runtime-input.yaml",
      "$PROFILE_ROOT/credential-manifest.json",
      "$PROFILE_ROOT/credential-map.json",
      "$PROFILE_ROOT/supabase-postgres.profile.json",
    ],
    outputs,
    mustPass,
  };
}
