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
    credentialCommand(
      "credential-staging-live",
      `${rootPrelude(input.outDir)}; VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1 deployment-control-plane credential-staging --live --bundle-dir "$PROFILE_ROOT" --live-backend-profile "$PROFILE_ROOT/live-infisical-backend.profile.json" --credential-directory /run/deployment-control-plane/credentials --out "$PROFILE_ROOT/credential-staging.live.json"`,
      ["$PROFILE_ROOT/credential-staging.live.json"],
      "deployment-owned live backend write and host mount verification pass",
      ["$PROFILE_ROOT/live-infisical-backend.profile.json"],
      `remote verifier alternative: VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1 deployment-control-plane credential-staging --live --bundle-dir "$PROFILE_ROOT" --live-backend-profile "$PROFILE_ROOT/live-infisical-backend.profile.json" --live-host-verification-evidence "$PROFILE_ROOT/live-host-verification.remote.json" --live-host-verifier-profile "$PROFILE_ROOT/live-host-verifier.profile.json" --live-host-verifier-trust-profile "$PROFILE_ROOT/live-host-verifier.trust.json" --out "$PROFILE_ROOT/credential-staging.live.json"`,
    ),
    credentialCommand(
      "credential-rotation",
      `${rootPrelude(input.outDir)}; deployment-control-plane credential-rotation --bundle-dir "$PROFILE_ROOT" --apply-rotation --out "$PROFILE_ROOT/credential-rotation.json" --rotated-map-out "$PROFILE_ROOT/credential-map.rotated.json"`,
      ["$PROFILE_ROOT/credential-rotation.json", "$PROFILE_ROOT/credential-map.rotated.json"],
      "credential rotation evidence is available when stale credentials must be replaced",
    ),
  ];
}

function credentialCommand(
  id: string,
  body: string,
  outputs: string[],
  mustPass: string,
  extraInputs: string[] = [],
  evidenceGuidance?: string,
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
      ...extraInputs,
    ],
    outputs,
    mustPass,
    ...(evidenceGuidance ? { evidenceGuidance } : {}),
  };
}
