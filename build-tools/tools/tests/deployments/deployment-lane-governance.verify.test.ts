#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";

async function writeJson(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("lane-governance verify command rejects source-ref drift and emits verified facts", async () => {
  await runInTemp("lane-governance-verify", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    await installNixosSharedHostTargets(tmp, [deployment]);
    const validSnapshot = path.join(tmp, "scm-policy.json");
    const invalidSnapshot = path.join(tmp, "scm-policy-invalid.json");
    await writeJson(validSnapshot, {
      scmBackend: deployment.lanePolicy.governance.scmBackend,
      repository: deployment.lanePolicy.governance.repository,
      sourceRefPolicies: deployment.lanePolicy.governance.sourceRefPolicies,
      trustedReporterIdentities: deployment.lanePolicy.governance.trustedReporterIdentities,
      requiredApprovalBoundaries: deployment.lanePolicy.governance.requiredApprovalBoundaries,
    });
    await writeJson(invalidSnapshot, {
      scmBackend: deployment.lanePolicy.governance.scmBackend,
      repository: deployment.lanePolicy.governance.repository,
      sourceRefPolicies: deployment.lanePolicy.governance.sourceRefPolicies.filter(
        (entry) => entry.stage !== "prod",
      ),
      trustedReporterIdentities: deployment.lanePolicy.governance.trustedReporterIdentities,
      requiredApprovalBoundaries: deployment.lanePolicy.governance.requiredApprovalBoundaries,
    });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deployment-lane-governance-verify.ts")} --deployment ${deployment.label} --scm-policy-json ${validSnapshot}`;
    const verified = JSON.parse(String(result.stdout));
    assert.equal(verified.governanceRef, deployment.lanePolicy.governanceRef);
    assert.equal(verified.sourceRefPolicies[2].stage, "prod");
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deployment-lane-governance-verify.ts")} --deployment ${deployment.label} --scm-policy-json ${invalidSnapshot}`,
      /missing required source-ref policy/,
    );
  });
});
