import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectWorkspaceArtifactSource } from "../../dev/artifact-policy-inspection";
import { chooseRunnableFlakeRef } from "../../dev/run-runnable-source";
import { runBoundedArtifactCommand } from "../../lib/artifact-command-runner";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export async function assertWorkspaceInspectionPropagatesInventoryFailure(): Promise<void> {
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
}

export async function assertDeploymentRejectsLocalPathBeforeConstruction(): Promise<void> {
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
}

export async function assertArtifactExecutorsUsePolicyAuthority(): Promise<void> {
  for (const file of ["build-selected.ts", "nix-build-filtered-flake.ts"]) {
    const source = await fsp.readFile(viberootsSourcePath(`build-tools/tools/dev/${file}`), "utf8");
    assert.match(source, /inspectArtifactBuildPolicy/);
    assert.match(source, /emitArtifactPolicyEvidence/);
    assert.match(source, /impureEvaluation: false/);
  }
  const command = await readDevSource("build-selected-nix-command.ts");
  assert.doesNotMatch(command, /"--impure"/);
  assert.match(command, /"--no-write-lock-file"/);
  const selected = await readDevSource("build-selected.ts");
  assert.match(selected, /inspectArtifactSource/);
  assert.match(selected, /"ls-files", "-z"/);
  assert.doesNotMatch(selected, /catch \{\s*return \{ flakeRef:/);
  const filtered = await readDevSource("nix-build-filtered-flake.ts");
  assert.match(
    filtered,
    /sourceInventory\.localDevelopment \|\| evaluationBundleHasLanguageOverrides\(devOverrides\)/,
  );
  assert.doesNotMatch(filtered, /localDevelopment: false/);
  assert.ok(
    filtered.indexOf("await inspectArtifactBuildPolicy") <
      filtered.indexOf("const workDir = await mkdtempNoindex"),
    "filtered source admission must precede snapshot creation",
  );
}

async function readDevSource(file: string): Promise<string> {
  return fsp.readFile(viberootsSourcePath(`build-tools/tools/dev/${file}`), "utf8");
}

export async function assertArtifactCommandTimeoutPolicy(): Promise<void> {
  const source = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/lib/artifact-command-runner.ts"),
    "utf8",
  );
  assert.match(source, /VBR_ARTIFACT_COMMAND_TIMEOUT_SECS, 600_000/);

  const env = externalNodeToolEnv({
    ...process.env,
    VBR_ARTIFACT_COMMAND_TIMEOUT_SECS: "",
  });
  const result = await runBoundedArtifactCommand({
    command: process.execPath,
    args: ["-e", ""],
    env,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);

  for (const timeout of ["0", "-1"]) {
    await assert.rejects(
      runBoundedArtifactCommand({
        command: process.execPath,
        args: ["-e", ""],
        env: { ...env, VBR_ARTIFACT_COMMAND_TIMEOUT_SECS: timeout },
      }),
      /invalid VBR_ARTIFACT_COMMAND_TIMEOUT_SECS/,
    );
  }
}

export async function assertArtifactCommandTimeoutReapsDescendants(): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-command-timeout-"));
  const pidFile = path.join(tmp, "descendant.pid");
  const marker = path.join(tmp, "descendant-survived");
  const descendantScript = [
    'const fs = require("node:fs")',
    'setTimeout(() => fs.writeFileSync(process.argv[1], "survived"), 10000)',
    "setInterval(() => {}, 1000)",
  ].join(";");
  const ownerScript = [
    'const fs = require("node:fs")',
    'const { spawn } = require("node:child_process")',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}, process.argv[2]], { stdio: "ignore" })`,
    "fs.writeFileSync(process.argv[1], String(child.pid))",
    "setInterval(() => {}, 1000)",
  ].join(";");

  try {
    const result = await runBoundedArtifactCommand({
      command: process.execPath,
      args: ["-e", ownerScript, pidFile, marker],
      env: externalNodeToolEnv(process.env),
      timeoutMs: 750,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.interrupted, false);
    const descendantPid = Number(await fsp.readFile(pidFile, "utf8"));
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 1);
    await waitForDead(descendantPid, 2_000);
    await assert.rejects(fsp.access(marker));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function waitForDead(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`artifact command descendant ${pid} survived its timeout`);
}
