#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectChangedPaths, requireChangedPaths } from "../../lib/build-system-test-scope";

async function git(root: string, ...args: string[]): Promise<void> {
  await $({ cwd: root })`git ${args}`;
}

async function commit(root: string, message: string): Promise<void> {
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    message,
  );
}

async function changed(root: string): Promise<string[]> {
  return requireChangedPaths(await collectChangedPaths(root, {}));
}

test("changed paths preserve unusual committed and working-tree names", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "changed-special-paths-"));
  const base = 'projects/app/base \t line\n quote" slash\\.ts ';
  const outside = 'outside base\tline\n"\\.ts ';
  try {
    await fsp.mkdir(path.join(root, "projects/app"), { recursive: true });
    await fsp.writeFile(path.join(root, base), "base\n");
    await fsp.writeFile(path.join(root, outside), "outside\n");
    await git(root, "init", "-b", "main");
    await git(root, "add", ".");
    await commit(root, "base");
    await git(root, "switch", "-c", "feature");

    const committed = 'projects/app/committed \t line\n quote" slash\\.ts ';
    await fsp.writeFile(path.join(root, committed), "committed\n");
    await git(root, "add", ".");
    await commit(root, "special committed path");
    assert.ok((await changed(root)).includes(committed));
    await git(root, "reset", "--hard", "main");

    const staged = "projects/app/staged\tname.ts";
    await fsp.writeFile(path.join(root, staged), "staged\n");
    await git(root, "add", staged);
    assert.ok((await changed(root)).includes(staged));
    await git(root, "reset", "--hard", "HEAD");

    await fsp.writeFile(path.join(root, base), "unstaged\n");
    assert.ok((await changed(root)).includes(base));
    await git(root, "reset", "--hard", "HEAD");

    const untracked = "projects/app/untracked\nname \\.ts";
    await fsp.writeFile(path.join(root, untracked), "untracked\n");
    assert.ok((await changed(root)).includes(untracked));
    await fsp.rm(path.join(root, untracked));

    await fsp.rm(path.join(root, base));
    assert.ok((await changed(root)).includes(base));
    await git(root, "reset", "--hard", "HEAD");

    const renames = [
      [outside, 'projects/app/incoming\nname\t"\\.ts '],
      [base, 'moved out\nname\t"\\.ts '],
      [base, 'projects/app/within\nname\t"\\.ts '],
    ] as const;
    for (const [from, to] of renames) {
      await git(root, "reset", "--hard", "HEAD");
      await git(root, "mv", from, to);
      const renamePaths = await changed(root);
      assert.ok(renamePaths.includes(from));
      assert.ok(renamePaths.includes(to));
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
