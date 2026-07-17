#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  artifactJobPurpose,
  assertArtifactBuildAdmitted,
  buildArtifactPolicyEvidence,
  classifyArtifactBuild,
  serializeArtifactPolicyEvidence,
} from "../../lib/artifact-build-policy";
import {
  inspectArtifactBuildPolicy,
  inspectWorkspaceArtifactSource,
} from "../../dev/artifact-policy-inspection";
import {
  inspectArtifactSource,
  parseUntrackedInventory,
  untrackedRequiresImpureForTargets,
} from "../../lib/artifact-source-inventory";
import { chooseRunnableFlakeRef } from "../../dev/run-runnable-source";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const effectiveConfig = {
  sandbox: { value: true },
  builders: { value: "" },
  substituters: { value: ["https://cache.example.invalid"] },
  "access-tokens": { value: { "github.com": "do-not-emit" } },
};

test("artifact classification has one canonical precedence", () => {
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

test("CI cannot be downgraded and invalid job purposes fail closed", () => {
  assert.equal(artifactJobPurpose({ CI: "1", VBR_ARTIFACT_JOB: "local" }), "ci");
  assert.equal(artifactJobPurpose({ VBR_ARTIFACT_JOB: "release" }), "release");
  assert.throws(
    () => artifactJobPurpose({ VBR_ARTIFACT_JOB: "maybe-release" }),
    /invalid VBR_ARTIFACT_JOB/,
  );
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
  });
  assert.deepEqual(evidence.evaluation.selectorEnvironment, ["BUCK_TARGET", "WORKSPACE_ROOT"]);
  assert.deepEqual(evidence.tools, { nix: "nix-bootstrap", zzz: "host" });
  assert.deepEqual(evidence.nix, {
    inspection: "available",
    sandbox: "enabled",
    builders: "local-only",
    substituters: "configured",
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
        builders: { value: field === "builders" ? undefined : "" },
        substituters: { value: field === "substituters" ? undefined : [] },
      },
    });
    assert.throws(() => assertArtifactBuildAdmitted(unknown), new RegExp(field));
  }
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

test("runtime inspection treats hostile JSON as data and does not emit it", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-policy-"));
  try {
    const nixBin = path.join(tmp, "nix");
    await fsp.writeFile(nixBin, "#!/bin/sh\nexit 0\n");
    await fsp.chmod(nixBin, 0o755);
    const evidence = await inspectArtifactBuildPolicy({
      classification: "hermetic",
      impureEvaluation: true,
      env: { VBR_NIX_BIN: nixBin },
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify(effectiveConfig),
        stderr: "hostile stderr secret",
      }),
    });
    assert.equal(evidence.nix.inspection, "available");
    assert.doesNotMatch(serializeArtifactPolicyEvidence(evidence), /secret|cache\.example/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("workspace source inspection propagates git inventory failure", async () => {
  const parent = path.join(process.cwd(), ".viberoots", "workspace", "buck", "tmp");
  await fsp.mkdir(parent, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(parent, "artifact-inventory-failure-"));
  try {
    await assert.rejects(
      inspectWorkspaceArtifactSource({
        workspaceRoot: tmp,
        targetPackages: [],
        env: { ...process.env, GIT_CEILING_DIRECTORIES: parent },
      }),
      /artifact source inventory failed/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deployment runnable admission rejects a local path before source construction", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-deployment-source-"));
  try {
    await assert.rejects(
      chooseRunnableFlakeRef({
        workspaceRoot: tmp,
        sourceMode: "path",
        attr: "graph-generator-selected",
        target: "//projects/app:bin",
        purpose: "deployment",
      }),
      /deployment artifact admission rejects local-development builds/,
    );
    assert.deepEqual(await fsp.readdir(tmp), []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("both artifact executors use policy authority with pure bundle evaluation", async () => {
  for (const file of ["build-selected.ts", "nix-build-filtered-flake.ts"]) {
    const source = await fsp.readFile(viberootsSourcePath(`build-tools/tools/dev/${file}`), "utf8");
    assert.match(source, /inspectArtifactBuildPolicy/);
    assert.match(source, /emitArtifactPolicyEvidence/);
    assert.match(source, /impureEvaluation: false/);
  }
  const command = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/build-selected-nix-command.ts"),
    "utf8",
  );
  assert.doesNotMatch(command, /"--impure"/);
  assert.match(command, /"--no-write-lock-file"/);
  const selected = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/build-selected.ts"),
    "utf8",
  );
  assert.match(selected, /inspectArtifactSource/);
  assert.match(selected, /"ls-files", "-z"/);
  assert.doesNotMatch(selected, /catch \{\s*return \{ flakeRef:/);
  const filtered = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/nix-build-filtered-flake.ts"),
    "utf8",
  );
  assert.match(
    filtered,
    /sourceInventory\.localDevelopment \|\| evaluationBundleHasLanguageOverrides\(process\.env\)/,
  );
  assert.doesNotMatch(filtered, /localDevelopment: false/);
  assert.ok(
    filtered.indexOf("await inspectArtifactBuildPolicy") <
      filtered.indexOf("const workDir = await mkdtempNoindex"),
    "filtered source admission must precede snapshot creation",
  );
});
