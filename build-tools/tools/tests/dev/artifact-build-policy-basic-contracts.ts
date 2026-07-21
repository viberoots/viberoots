import assert from "node:assert/strict";
import path from "node:path";
import type { test } from "node:test";
import { artifactJobPurpose, classifyArtifactBuild } from "../../lib/artifact-build-policy";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { canonicalArtifactGraphEnvironment } from "../../dev/artifact-graph-executor";
import {
  assertArtifactCommandTimeoutPolicy,
  assertArtifactCommandTimeoutReapsDescendants,
  assertArtifactExecutorsUsePolicyAuthority,
  assertDeploymentRejectsLocalPathBeforeConstruction,
  assertWorkspaceInspectionPropagatesInventoryFailure,
} from "./artifact-build-policy-test-helpers";

export const EFFECTIVE_ARTIFACT_TEST_CONFIG = {
  sandbox: { value: true },
  "sandbox-fallback": { value: false },
  "sandbox-paths": { value: {} },
  builders: { value: "" },
  substituters: { value: [...REVIEWED_SUBSTITUTERS] },
  "trusted-public-keys": { value: [...REVIEWED_PUBLIC_KEYS] },
  "access-tokens": { value: { "github.com": "do-not-emit" } },
};

export function registerArtifactBuildPolicyBasicContracts(register: typeof test): void {
  register("artifact classification has one canonical precedence", () => {
    assert.equal(
      classifyArtifactBuild({ diagnosticImpure: false, localDevelopment: false }),
      "hermetic",
    );
    assert.equal(
      classifyArtifactBuild({ diagnosticImpure: false, localDevelopment: true }),
      "local-development",
    );
    assert.equal(
      classifyArtifactBuild({ diagnosticImpure: true, localDevelopment: true }),
      "diagnostic-impure",
    );
  });

  register("CI cannot be downgraded and invalid job purposes fail closed", () => {
    assert.equal(artifactJobPurpose({ CI: "1", VBR_ARTIFACT_JOB: "local" }), "ci");
    assert.equal(artifactJobPurpose({ VBR_ARTIFACT_JOB: "release" }), "release");
    assert.throws(
      () => artifactJobPurpose({ VBR_ARTIFACT_JOB: "maybe-release" }),
      /invalid VBR_ARTIFACT_JOB/,
    );
  });

  register(
    "canonical graph executor bypasses hostile host tools and declares selectors explicitly",
    () => {
      const artifactToolsRoot = canonicalArtifactToolsRoot(
        process.cwd(),
        String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
      );
      const env = canonicalArtifactGraphEnvironment({
        workspaceRoot: process.cwd(),
        artifactToolsRoot,
        target: "//projects/apps/demo:app",
        graphPath: path.join(process.cwd(), "buck-out", "graph.json"),
        baseEnv: {
          PATH: "/tmp/host-tools",
          HOME: "/tmp/host-home",
          BUCK_TARGET: "//host:wrong",
          BUCK_QUERY_ROOTS: "host-only",
          BUCK_TARGET_PLATFORM: "//host:platform",
        },
      });
      const toolsRoot = String(env.VBR_ARTIFACT_TOOLS_ROOT || "");
      assert.equal(env.PATH, path.join(toolsRoot, "bin"));
      assert.equal(env.BUCK_TARGET, "//projects/apps/demo:app");
      assert.notEqual(env.BUCK_QUERY_ROOTS, "host-only");
      assert.equal(env.BUCK_TARGET_PLATFORMS, "prelude//platforms:default");
      assert.match(String(env.VIBEROOTS_SOURCE_ROOT || ""), /^\/nix\/store\//);
    },
  );
}

export function registerArtifactBuildPolicyDelegatedContracts(register: typeof test): void {
  register("workspace source inspection propagates git inventory failure", async () => {
    await assertWorkspaceInspectionPropagatesInventoryFailure();
  });
  register(
    "deployment runnable admission rejects a local path before source construction",
    async () => {
      await assertDeploymentRejectsLocalPathBeforeConstruction();
    },
  );
  register("both artifact executors use policy authority with pure bundle evaluation", async () => {
    await assertArtifactExecutorsUsePolicyAuthority();
  });
  register("artifact commands use a bounded default and reject nonpositive timeouts", async () => {
    await assertArtifactCommandTimeoutPolicy();
  });
  register("artifact command timeouts await termination of their owned descendants", async () => {
    await assertArtifactCommandTimeoutReapsDescendants();
  });
}
