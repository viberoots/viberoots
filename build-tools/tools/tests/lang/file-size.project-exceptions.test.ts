#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { SOURCE_FILES_SCOPE, findFileSizeOffenders } from "../../dev/file-size-lint";
import {
  METHODOLOGY_EXCEPTIONS_FILENAME,
  resolveSourceFileSizeExceptionPaths,
} from "../../dev/file-size-lint-exceptions";

function oversizedModule(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `export const line${index} = ${index};`).join(
    "\n",
  );
}

const execFileAsync = promisify(execFile);

async function withTempRoot<T>(name: string, fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    return await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function initTrackedFixture(root: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "codex@example.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Codex"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
}

test("project-local file-size exceptions stay scoped to the owning project", async () => {
  await withTempRoot("file-size-project-exceptions", async (tmp) => {
    const pleominoRoot = path.join(tmp, "projects/apps/pleomino");
    const otherRoot = path.join(tmp, "projects/apps/other");
    const pleominoSource = "src/generated/oversized.ts";
    const otherSource = "src/generated/oversized.ts";

    await fsp.mkdir(path.join(pleominoRoot, "src/generated"), { recursive: true });
    await fsp.mkdir(path.join(otherRoot, "src/generated"), { recursive: true });
    await fsp.writeFile(
      path.join(pleominoRoot, METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify(
        {
          sourceFileSizeExceptions: [
            {
              path: pleominoSource,
              justification: "Generated fixture owned by Pleomino.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(path.join(pleominoRoot, pleominoSource), oversizedModule(260), "utf8");
    await fsp.writeFile(path.join(otherRoot, otherSource), oversizedModule(260), "utf8");
    await initTrackedFixture(tmp);

    const exceptions = await resolveSourceFileSizeExceptionPaths(tmp);
    assert.equal(exceptions.includes("projects/apps/pleomino/src/generated/oversized.ts"), true);
    assert.equal(exceptions.includes("projects/apps/other/src/generated/oversized.ts"), false);

    const offenders = await findFileSizeOffenders({
      root: tmp,
      changedOnly: false,
      threshold: 250,
      failOnOffenders: true,
      allowKnown: false,
      scope: SOURCE_FILES_SCOPE,
    });

    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["projects/apps/other/src/generated/oversized.ts"],
    );
  });
});

test("build-tools-local file-size exceptions stay scoped to the owning subtree", async () => {
  await withTempRoot("file-size-build-tools-exceptions", async (tmp) => {
    const testsRoot = path.join(tmp, "build-tools/tools/tests");
    const nixRoot = path.join(tmp, "build-tools/tools/nix");
    const testsSource = "scaffolding/oversized.test.ts";
    const nixSource = "oversized.nix";

    await fsp.mkdir(path.join(testsRoot, "scaffolding"), { recursive: true });
    await fsp.mkdir(nixRoot, { recursive: true });
    await fsp.writeFile(
      path.join(testsRoot, METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify(
        {
          sourceFileSizeExceptions: [
            {
              path: testsSource,
              justification: "Legacy build-tools test fixture pending decomposition.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(path.join(testsRoot, testsSource), oversizedModule(260), "utf8");
    await fsp.writeFile(path.join(nixRoot, nixSource), oversizedModule(260), "utf8");
    await initTrackedFixture(tmp);

    const exceptions = await resolveSourceFileSizeExceptionPaths(tmp);
    assert.equal(
      exceptions.includes("build-tools/tools/tests/scaffolding/oversized.test.ts"),
      true,
    );
    assert.equal(exceptions.includes("build-tools/tools/nix/oversized.nix"), false);

    const offenders = await findFileSizeOffenders({
      root: tmp,
      changedOnly: false,
      threshold: 250,
      failOnOffenders: true,
      allowKnown: false,
      scope: SOURCE_FILES_SCOPE,
    });

    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["build-tools/tools/nix/oversized.nix"],
    );
  });
});

test("repo-root file-size exceptions are rejected", async () => {
  await withTempRoot("file-size-root-exceptions-rejected", async (tmp) => {
    await fsp.writeFile(
      path.join(tmp, METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify(
        {
          sourceFileSizeExceptions: [
            {
              path: "build-tools/tools/example.ts",
              justification: "Root manifests would recreate a shared registry.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(resolveSourceFileSizeExceptionPaths(tmp), /must not live at repo root/);
  });
});
