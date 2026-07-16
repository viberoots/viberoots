#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  PROJECT_SOURCE_FILES_SCOPE,
  SOURCE_FILES_SCOPE,
  findFileSizeOffenders,
} from "../../dev/file-size-lint";
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
    const sampleRoot = path.join(tmp, "projects/apps/sample-webapp");
    const otherRoot = path.join(tmp, "projects/apps/other");
    const sampleSource = "src/generated/oversized.ts";
    const otherSource = "src/generated/oversized.ts";

    await fsp.mkdir(path.join(sampleRoot, "src/generated"), { recursive: true });
    await fsp.mkdir(path.join(otherRoot, "src/generated"), { recursive: true });
    await fsp.writeFile(
      path.join(sampleRoot, METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify(
        {
          sourceFileSizeExceptions: [
            {
              path: sampleSource,
              justification: "Generated fixture owned by the sample web app.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(path.join(sampleRoot, sampleSource), oversizedModule(260), "utf8");
    await fsp.writeFile(path.join(otherRoot, otherSource), oversizedModule(260), "utf8");
    await initTrackedFixture(tmp);

    const exceptions = await resolveSourceFileSizeExceptionPaths(tmp);
    assert.equal(
      exceptions.includes("projects/apps/sample-webapp/src/generated/oversized.ts"),
      true,
    );
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

test("project source scope rejects an unlisted offender and preserves owner-local exceptions", async () => {
  await withTempRoot("file-size-project-scope", async (tmp) => {
    const project = path.join(tmp, "projects/apps/demo");
    await fsp.mkdir(path.join(project, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(project, METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify({
        sourceFileSizeExceptions: [
          { path: "src/allowed.ts", justification: "Generated project source fixture." },
        ],
      }),
    );
    await fsp.writeFile(path.join(project, "src/allowed.ts"), oversizedModule(260));
    await fsp.writeFile(path.join(project, "src/rejected.ts"), oversizedModule(270));
    await fsp.writeFile(path.join(project, "src/untracked.ts"), oversizedModule(275));
    await fsp.mkdir(path.join(tmp, "build-tools"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "build-tools/ignored.ts"), oversizedModule(280));
    await initTrackedFixture(tmp);
    await execFileAsync("git", ["reset", "projects/apps/demo/src/untracked.ts"], { cwd: tmp });

    const offenders = await findFileSizeOffenders({
      root: tmp,
      changedOnly: false,
      threshold: 250,
      failOnOffenders: true,
      allowKnown: false,
      scope: PROJECT_SOURCE_FILES_SCOPE,
    });
    assert.deepEqual(offenders, [
      { file: "projects/apps/demo/src/untracked.ts", lines: 275 },
      { file: "projects/apps/demo/src/rejected.ts", lines: 270 },
    ]);
  });
});
