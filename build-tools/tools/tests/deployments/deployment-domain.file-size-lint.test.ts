#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { SOURCE_FILES_SCOPE, findFileSizeOffenders } from "../../dev/file-size-lint.ts";

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-file-size-"));
  try {
    return await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function writeLines(root: string, relPath: string, count: number): Promise<void> {
  const absPath = path.join(root, relPath);
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
  const body = Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
  await fsp.writeFile(absPath, body, "utf8");
}

const execFileAsync = promisify(execFile);

async function initTrackedFixture(root: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "codex@example.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Codex"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
}

async function runFileSizeLint(root: string): Promise<{ code: number | null; stderr: string }> {
  const scriptPath = path.join(process.cwd(), "build-tools/tools/dev/file-size-lint.ts");
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "tsx",
        "--import",
        "./build-tools/tools/dev/zx-init.mjs",
        scriptPath,
        "--root",
        root,
        "--scope",
        "source",
        "--fail=true",
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function isDeploymentOwnedFile(file: string): boolean {
  return (
    file.startsWith("build-tools/deployments/") ||
    file.startsWith("build-tools/tools/deployments/") ||
    file.startsWith("build-tools/tools/tests/deployments/")
  );
}

test("repo-owned file-size gate keeps deployment-owned files under the methodology limit", async () => {
  const offenders = await findFileSizeOffenders({
    root: process.cwd(),
    changedOnly: false,
    threshold: 250,
    failOnOffenders: true,
    allowKnown: false,
    scope: SOURCE_FILES_SCOPE,
  });
  assert.deepEqual(
    offenders.filter(({ file }) => isDeploymentOwnedFile(file)),
    [],
  );
});

test("repo-owned file-size lint reports deployment-owned offenders with line counts", async () => {
  await withTempRoot(async (root) => {
    const offenderPath = "build-tools/tools/tests/deployments/demo.offender.test.ts";
    await writeLines(root, offenderPath, 251);
    await writeLines(root, "docs/ignored.ts", 400);
    await initTrackedFixture(root);

    const offenders = await findFileSizeOffenders({
      root,
      changedOnly: false,
      threshold: 250,
      failOnOffenders: true,
      allowKnown: false,
      scope: SOURCE_FILES_SCOPE,
    });

    assert.deepEqual(offenders, [{ file: offenderPath, lines: 251 }]);

    const result = await runFileSizeLint(root);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /demo\.offender\.test\.ts/);
    assert.match(result.stderr, /251 lines/);
  });
});
