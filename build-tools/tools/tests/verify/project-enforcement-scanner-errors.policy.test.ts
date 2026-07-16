#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listFilesMatching } from "../../dev/file-size-globs";
import { scanProcessInspectionTree } from "../../lib/process-inspection-scanner";
import { listProjectFiles, readProjectFile } from "../../project-enforcement/project-file-tree";

async function fileInsteadOfDirectory(name: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  const file = path.join(root, "not-a-directory");
  await fsp.writeFile(file, "fixture\n");
  return file;
}

test("project tree scanner fails closed with the unreadable directory path", async () => {
  const file = await fileInsteadOfDirectory("project-tree-read-error");
  await assert.rejects(() => listProjectFiles(file, () => true), new RegExp(file));
  await assert.rejects(
    () => listProjectFiles(file, () => true, { optionalRoot: true }),
    new RegExp(file),
  );
});

test("deployment project scans ignore only an explicitly optional missing root", async () => {
  const missing = path.join(os.tmpdir(), `optional-deployments-${process.pid}-${Date.now()}`);
  await assert.rejects(() => listProjectFiles(missing, () => true), new RegExp(missing));
  assert.deepEqual(await listProjectFiles(missing, () => true, { optionalRoot: true }), []);
});

test("optional project roots retain fail-closed descendant errors", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "optional-root-descendant-"));
  const child = path.join(root, "child");
  await fsp.mkdir(child);
  await fsp.writeFile(path.join(root, "trigger.ts"), "fixture\n");
  await assert.rejects(
    () =>
      listProjectFiles(
        root,
        () => {
          rmSync(child, { recursive: true });
          return false;
        },
        { optionalRoot: true },
      ),
    new RegExp(child),
  );
});

test("stale-name project reads fail closed with the unreadable file path", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "stale-name-read-error-"));
  const missing = path.join(root, "projects/app/missing.ts");
  await assert.rejects(
    () => readProjectFile(missing, "stale-name scanner"),
    (error: Error) => {
      assert.match(error.message, /stale-name scanner cannot read file/);
      assert.match(error.message, new RegExp(missing));
      return true;
    },
  );
});

test("process inspection scanner fails closed with the unreadable directory path", async () => {
  const file = await fileInsteadOfDirectory("process-inspection-read-error");
  await assert.rejects(() => scanProcessInspectionTree({ root: file }), new RegExp(file));
});

test("file-size scanner fails closed with the unreadable directory path", async () => {
  const file = await fileInsteadOfDirectory("file-size-read-error");
  await assert.rejects(
    () => listFilesMatching({ root: file, include: ["**/*.ts"], exclude: [] }),
    new RegExp(file),
  );
});

test("file-size scanner ignores a missing root only when explicitly optional", async () => {
  const missing = path.join(os.tmpdir(), `optional-file-size-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => listFilesMatching({ root: missing, include: ["**/*.ts"], exclude: [] }),
    new RegExp(missing),
  );
  assert.deepEqual(
    await listFilesMatching({
      root: missing,
      include: ["**/*.ts"],
      exclude: [],
      optionalRoot: true,
    }),
    [],
  );
});
