#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  assertArtifactBuildAdmitted,
  buildArtifactPolicyEvidence,
  serializeArtifactPolicyEvidence,
} from "../../lib/artifact-build-policy";
import {
  admitArtifactContext,
  hasRejectedNixPolicyDiagnostics,
  inspectArtifactBuildPolicy,
} from "../../dev/artifact-policy-inspection";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import {
  inspectArtifactSource,
  parseUntrackedInventory,
  untrackedRequiresImpureForTargets,
} from "../../lib/artifact-source-inventory";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import {
  EFFECTIVE_ARTIFACT_TEST_CONFIG as effectiveConfig,
  registerArtifactBuildPolicyBasicContracts,
  registerArtifactBuildPolicyDelegatedContracts,
} from "./artifact-build-policy-basic-contracts";

registerArtifactBuildPolicyBasicContracts(test);

test("artifact policy inspection rejects ignored restricted Nix settings", () => {
  for (const diagnostic of [
    "warning: ignoring the user-specified setting 'sandbox', because it is a restricted setting and you are not a trusted user",
    "warning: option 'builders' requires a trusted user",
    "warning: not allowed to set restricted option sandbox-paths",
  ]) {
    assert.equal(hasRejectedNixPolicyDiagnostics(diagnostic), true, diagnostic);
  }
  assert.equal(hasRejectedNixPolicyDiagnostics("warning: Git tree is dirty"), false);
});

test("policy evidence is deterministic and redacts values and machine identity", () => {
  const evidence = buildArtifactPolicyEvidence({
    classification: "hermetic",
    purpose: "local",
    impureEvaluation: true,
    env: {
      BUCK_TARGET: "//projects/private:secret",
      WORKSPACE_ROOT: "/Users/private/workspace",
    },
    toolPaths: { zzz: "/usr/bin/zzz", nix: "/nix/var/nix/profiles/default/bin/nix" },
    nixConfig: effectiveConfig,
    nixStoreUrl: "daemon",
  });
  assert.deepEqual(evidence.evaluation.selectorEnvironment, ["BUCK_TARGET", "WORKSPACE_ROOT"]);
  assert.deepEqual(evidence.tools, { nix: "nix-bootstrap", zzz: "host" });
  assert.deepEqual(evidence.nix, {
    inspection: "available",
    sandbox: "enabled",
    sandboxFallback: "disabled",
    hostPaths: "none",
    multiUser: "daemon",
    builders: "local-only",
    substituters: "reviewed",
    publicKeys: "reviewed",
    network: "sandboxed-fixed-output-only",
  });
  const serialized = serializeArtifactPolicyEvidence(evidence);
  assert.equal(serialized, serializeArtifactPolicyEvidence(evidence));
  for (const secret of ["do-not-emit", "cache.example.invalid", "private", "/usr/bin/zzz"]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replaceAll("/", "\\/")));
  }
});

test("protected admission rejects explicit impurity and missing inspection", () => {
  for (const classification of ["local-development", "diagnostic-impure"] as const) {
    const evidence = buildArtifactPolicyEvidence({
      classification,
      purpose: "deployment",
      impureEvaluation: true,
      env: {},
      toolPaths: {},
      nixConfig: effectiveConfig,
      nixStoreUrl: "daemon",
    });
    assert.throws(() => assertArtifactBuildAdmitted(evidence), /rejects/);
  }
  const unavailable = buildArtifactPolicyEvidence({
    classification: "hermetic",
    purpose: "ci",
    impureEvaluation: true,
    env: {},
    toolPaths: {},
    nixInspection: "unavailable",
  });
  assert.throws(() => assertArtifactBuildAdmitted(unavailable), /requires effective Nix policy/);
  for (const field of ["sandbox", "builders", "substituters"] as const) {
    const unknown = buildArtifactPolicyEvidence({
      classification: "hermetic",
      purpose: "release",
      impureEvaluation: true,
      env: {},
      toolPaths: {},
      nixConfig: {
        sandbox: { value: field === "sandbox" ? undefined : true },
        "sandbox-fallback": { value: false },
        "sandbox-paths": { value: {} },
        builders: { value: field === "builders" ? undefined : "" },
        substituters: {
          value: field === "substituters" ? undefined : [...REVIEWED_SUBSTITUTERS],
        },
        "trusted-public-keys": { value: [...REVIEWED_PUBLIC_KEYS] },
      },
      nixStoreUrl: "daemon",
    });
    assert.throws(() => assertArtifactBuildAdmitted(unknown), new RegExp(field));
  }
});

test("artifact admission rejects exact tool paths outside the declared closure", () => {
  const evidence = buildArtifactPolicyEvidence({
    classification: "hermetic",
    purpose: "local",
    impureEvaluation: false,
    env: {
      VBR_ARTIFACT_TOOLS_ROOT: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-tools-a",
    },
    toolPaths: {
      node: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-tools-b/bin/node",
      nix: "/nix/var/nix/profiles/default/bin/nix",
    },
    nixConfig: effectiveConfig,
    nixStoreUrl: "daemon",
  });
  assert.throws(
    () => assertArtifactBuildAdmitted(evidence),
    /tools outside the canonical closure: node/,
  );
});

test("artifact admission requires exact node and Nix closure evidence", () => {
  const evidence = buildArtifactPolicyEvidence({
    classification: "hermetic",
    purpose: "local",
    impureEvaluation: false,
    env: {},
    toolPaths: {},
    nixConfig: effectiveConfig,
    nixStoreUrl: "daemon",
  });
  assert.throws(() => assertArtifactBuildAdmitted(evidence), /exact canonical tool closure root/);
});

test("source inventory is exact, target-aware, and fails closed", async () => {
  assert.deepEqual(parseUntrackedInventory("projects/app/new file.ts\0docs/note.md\0"), [
    "projects/app/new file.ts",
    "docs/note.md",
  ]);
  assert.throws(() => parseUntrackedInventory("projects/app/truncated"), /truncated/);
  assert.deepEqual(
    untrackedRequiresImpureForTargets({
      untracked: ["projects/app/new.ts", "docs/note.md"],
      targetPackages: ["projects/app"],
    }),
    {
      requiresImpure: true,
      relevant: ["projects/app/new.ts"],
      ignored: ["docs/note.md"],
    },
  );
  await assert.rejects(
    inspectArtifactSource({
      targetPackages: [],
      runGit: async () => ({ exitCode: 2, stdout: "", stderr: "inventory denied" }),
    }),
    /artifact source inventory failed: inventory denied/,
  );
});

test("runtime inspection derives executing Node evidence only from the process", async () => {
  const env = buildCanonicalArtifactEnvironment(process.cwd(), {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
  const inspect = () =>
    inspectArtifactBuildPolicy({
      classification: "hermetic",
      impureEvaluation: true,
      env,
      toolPaths: { node: `${env.VBR_ARTIFACT_TOOLS_ROOT}/bin/node` },
      runCommand: async (_command, args) => ({
        exitCode: 0,
        stdout: JSON.stringify(args.includes("info") ? { url: "daemon" } : effectiveConfig),
        stderr: "hostile stderr secret",
      }),
    });
  const canonicalNode = fs.realpathSync(`${env.VBR_ARTIFACT_TOOLS_ROOT}/bin/node`);
  if (fs.realpathSync(process.execPath) !== canonicalNode) {
    await assert.rejects(inspect, /executing Node is outside the canonical tool closure/);
    return;
  }
  const evidence = await inspect();
  assert.equal(evidence.tools.node, "nix-store");
  assert.doesNotMatch(serializeArtifactPolicyEvidence(evidence), /secret|cache\.example/);
});

test("artifact context admission rejects a noncanonical executor instead of admitting a child", async () => {
  const env = buildCanonicalArtifactEnvironment(process.cwd(), {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
  const admission = admitArtifactContext({
    classification: "hermetic",
    purpose: "local",
    impureEvaluation: false,
    env,
    workspaceRoot: process.cwd(),
  });
  const canonicalNode = fs.realpathSync(`${env.VBR_ARTIFACT_TOOLS_ROOT}/bin/node`);
  if (fs.realpathSync(process.execPath) !== canonicalNode) {
    await assert.rejects(admission, /must execute under the canonical Node closure/);
    return;
  }
  const evidence = await admission;
  assert.equal(evidence.tools.node, "nix-store");
});

registerArtifactBuildPolicyDelegatedContracts(test);
