import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  runReadOnlyLanguageConsistencyChecks,
  type ReadOnlyLanguageChecks,
} from "../../dev/dependency-consistency";
import { staleMetadataError } from "../../dev/install/metadata-mode";

async function mixedLanguageFixture(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-consistency-languages-"));
  const project = path.join(root, "projects/apps/mixed");
  await fsp.mkdir(project, { recursive: true });
  await fsp.writeFile(path.join(project, "go.mod"), "module example.test/mixed\n");
  await fsp.writeFile(path.join(project, "pyproject.toml"), "[project]\nname='mixed'\n");
  await fsp.writeFile(path.join(project, "main.cpp"), "int main() { return 0; }\n");
  await execFile("git", ["init", "-q"], root);
  await execFile("git", ["add", "projects"], root);
  return root;
}

async function execFile(command: string, args: string[], cwd: string): Promise<void> {
  const { execFile: run } = await import("node:child_process");
  await new Promise<void>((resolve, reject) =>
    run(command, args, { cwd }, (error) => (error ? reject(error) : resolve())),
  );
}

test("language-wide consistency dispatches every enabled surface through one registry", async () => {
  const root = await mixedLanguageFixture();
  const reached: string[] = [];
  const checks = Object.fromEntries(
    ["go", "python", "cpp"].map((id) => [id, async () => reached.push(id)]),
  ) as ReadOnlyLanguageChecks;
  try {
    await runReadOnlyLanguageConsistencyChecks(root, checks);
    assert.deepEqual(reached, ["go", "python", "cpp"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("every language stale-state failure is read-only and points to u", async () => {
  for (const id of ["go", "python", "cpp"] as const) {
    const root = await mixedLanguageFixture();
    const marker = path.join(root, "projects/apps/mixed", `${id}.marker`);
    await fsp.writeFile(marker, "unchanged\n");
    const checks = Object.fromEntries(
      ["go", "python", "cpp"].map((candidate) => [
        candidate,
        async () => {
          if (candidate === id) throw staleMetadataError(`${id}.lock`, `${id} stale fixture`);
        },
      ]),
    ) as ReadOnlyLanguageChecks;
    try {
      await assert.rejects(
        runReadOnlyLanguageConsistencyChecks(root, checks),
        new RegExp(`tracked metadata is stale: ${id}\\.lock[\\s\\S]*repair: run u`),
      );
      assert.equal(await fsp.readFile(marker, "utf8"), "unchanged\n");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
});
