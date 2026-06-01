#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { runInScratchTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";

test("cutover CLI rejects PrivateLink topology with wrong managed dependency identity", async () => {
  await runInScratchTemp("cutover-privatelink-identity", async (tmp) => {
    const evidencePath = path.join(tmp, "evidence.json");
    const imported = evidence() as any;
    await fsp.writeFile(
      evidencePath,
      JSON.stringify({
        ...imported,
        managedDependencies: {
          ...imported.managedDependencies,
          runtimePath: {
            ...imported.managedDependencies.runtimePath,
            supabaseProjectRef: "wrong-project",
            privatelinkEndpointId: "vpce-other",
          },
          postgres: {
            ...imported.managedDependencies.postgres,
            supabaseProjectRef: "wrong-project",
            privatelinkEndpointId: "vpce-other",
          },
        },
      }),
    );
    await assert.rejects(
      () => runCutover(evidencePath),
      /Supabase project ref does not match|PrivateLink endpoint id does not match/,
    );
  });
});

test("cutover CLI rejects diagnostic-only PrivateLink managed dependency evidence", async () => {
  await runInScratchTemp("cutover-privatelink-diagnostic", async (tmp) => {
    const evidencePath = path.join(tmp, "evidence.json");
    const imported = evidence() as any;
    await fsp.writeFile(
      evidencePath,
      JSON.stringify({
        ...imported,
        managedDependencies: {
          ...imported.managedDependencies,
          runtimePath: {
            ...imported.managedDependencies.runtimePath,
            nonCutoverDiagnostic: true,
          },
        },
      }),
    );
    await assert.rejects(() => runCutover(evidencePath), /diagnostic-only/);
  });
});

test("cutover CLI rejects mismatched AWS-side PrivateLink provider evidence", async () => {
  await runInScratchTemp("cutover-privatelink-provider-mismatch", async (tmp) => {
    const evidencePath = path.join(tmp, "evidence.json");
    const imported = evidence() as any;
    const hook = await runCloudProviderCapabilityHook({
      capabilityId: "supabase-privatelink-prerequisite",
      phase: "smoke",
      deploymentLabel: "//deployments:staging",
      awsTopologyEvidence: privateLinkAwsTopology() as any,
    });
    await fsp.writeFile(
      evidencePath,
      JSON.stringify({
        ...imported,
        providerCapabilities: {
          ...imported.providerCapabilities,
          "supabase-privatelink-prerequisite": {
            ...hook,
            providerPayload: {
              ...hook.providerPayload,
              ram: { ...(hook.providerPayload?.ram as any), ramShareArn: "arn:aws:ram:wrong" },
              lattice: {
                ...(hook.providerPayload?.lattice as any),
                endpointId: "vpce-wrong",
              },
            },
          },
        },
      }),
    );
    await assert.rejects(() => runCutover(evidencePath), /RAM share ARN|VPC Lattice association/);
  });
});

function runCutover(evidencePath: string) {
  return withControlPlaneArgv(
    [
      "cutover",
      "--evidence",
      evidencePath,
      "--expected-host-profile",
      "aws-ec2",
      "--expected-image-build-identity",
      IMAGE_BUILD_IDENTITY,
      "--expected-region",
      "us-east-1",
    ],
    runDeploymentControlPlaneCommand,
  );
}
