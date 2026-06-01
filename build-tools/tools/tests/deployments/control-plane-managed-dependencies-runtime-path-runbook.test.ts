#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { serviceNetworkAssociationEvidence } from "./cloud-control-supabase-privatelink.fixture";
import { setupInput } from "./control-plane-managed-dependencies-runtime-path.fixture";

test("AWS setup profile renders runtime-path expectations and runbook source-host proof", () => {
  const bundle = renderCloudControlSetupBundle(setupInput());
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(profile.runtimePath.expectedHostProfile, "aws-ec2");
  assert.equal(profile.runtimePath.databaseConnectivityMode, "privatelink");
  assert.equal(profile.runtimePath.expectedSupabaseProjectRef, "project-review");
  assert.equal(profile.runtimePath.expectedSupabaseRegion, "us-east-1");
  assert.equal(profile.runtimePath.expectedPrivateLinkEndpointId, "vpce-privatelink123");
  assert.equal(profile.runtimePath.expectedS3VpcEndpointId, "vpce-123");
  assert.equal(profile.artifactStore.provider, "aws-s3");
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = runbookCommand(commands, "database").command;
  assert.match(managed, /source-host-identity/);
  assert.match(managed, /host-profile "\$RUNTIME_HOST_PROFILE"/);
  assert.match(managed, /aws-region "\$SOURCE_AWS_REGION"/);
  assert.match(managed, /supabase-project-ref 'project-review'/);
  assert.match(managed, /supabase-region 'us-east-1'/);
  assert.match(managed, /privatelink-endpoint-id 'vpce-privatelink123'/);
  assert.match(managed, /s3-vpc-endpoint-id 'vpce-123'/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_PRIVATELINK_ENDPOINT_ID/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_S3_VPC_ENDPOINT_ID/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_SUPABASE_/);
  assert.match(managed, /169\.254\.169\.254/);
});

test("AWS setup runbook surfaces PrivateLink operator evidence actions from bundle root", () => {
  const commands = JSON.parse(renderCloudControlSetupBundle(setupInput()).files["commands.json"]!);
  const managedPhase = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const ids = managedPhase.commands.map((command: any) => command.id);
  assert.equal(ids[0], "supabase-managed-postgres-evidence");
  const privateLinkIds = ids.filter((id: string) => id.startsWith("supabase-privatelink-"));
  assert.deepEqual(privateLinkIds, [
    "supabase-privatelink-support-initiation",
    "supabase-privatelink-ram-acceptance",
    "supabase-privatelink-vpc-lattice",
    "supabase-privatelink-private-dns",
    "supabase-privatelink-tcp-5432-sg",
    "supabase-privatelink-private-psql",
  ]);
  for (const id of privateLinkIds) {
    const action = runbookCommand(commands, id);
    assert.equal(action.cwd, "profile-root");
    assert.equal(action.actionType, "operator-evidence");
    assert.match(action.evidenceGuidance, /evidence/i);
    assert.match(action.command, /PROFILE_ROOT="\$\{PROFILE_ROOT:-\$\(pwd\)\}"/);
    assert.match(action.command, /test -f "\$PROFILE_ROOT\/supabase-privatelink-/);
    assert.doesNotMatch(action.command, /--out/);
  }
  assert.match(managedPhase.residualManualActions.join("\n"), /PrivateLink operator-evidence/);
  assert.match(managedPhase.evidenceInputs.join("\n"), /supabase-privatelink-ram-acceptance\.json/);
});

test("AWS setup runbook names the VPC Lattice service-network variant", () => {
  const input = setupInput();
  input.awsTopology = {
    ...input.awsTopology,
    database: { mode: "privatelink", privatelink: serviceNetworkAssociationEvidence() },
  } as any;
  const commands = JSON.parse(renderCloudControlSetupBundle(input).files["commands.json"]!);
  assert.match(
    runbookCommand(commands, "supabase-privatelink-vpc-lattice").evidenceGuidance,
    /service-network association/,
  );
});

function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}
