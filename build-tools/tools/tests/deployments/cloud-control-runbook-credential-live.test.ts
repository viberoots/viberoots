import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { input } from "./control-plane-credential-live.fixture";

test("generated runbook exposes live credential command only through explicit gate", () => {
  const commands = JSON.parse(renderCloudControlSetupBundle(input()).files["commands.json"]!);
  const live = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === "credential-staging-live");
  assert.ok(live);
  assert.match(live.command, /VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1/);
  assert.match(live.command, /--live/);
  assert.match(
    live.command,
    /--live-backend-profile "\$PROFILE_ROOT\/live-infisical-backend\.profile\.json"/,
  );
  assert.match(live.command, /--credential-directory \/run\/deployment-control-plane\/credentials/);
  assert.match(
    live.command,
    /--live-host-verifier-profile "\$PROFILE_ROOT\/live-host-verifier\.profile\.json"/,
  );
  assert.ok(live.inputs.includes("$PROFILE_ROOT/live-infisical-backend.profile.json"));
  assert.ok(live.inputs.includes("$PROFILE_ROOT/live-host-verifier.profile.json"));
  assert.ok(live.outputs.includes("$PROFILE_ROOT/credential-staging.live.json"));
  const cutover = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === "cutover-evidence");
  assert.ok(cutover.inputs.includes("$PROFILE_ROOT/credential-staging.live.json"));
  assert.ok(!cutover.inputs.includes("$PROFILE_ROOT/credential-staging.json"));
});
